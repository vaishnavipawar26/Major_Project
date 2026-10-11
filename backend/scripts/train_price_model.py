"""Stage 6a: train and evaluate the daily price forecaster (direct multi-horizon models).

Run from backend/ after prepare_price_data:  python -m scripts.train_price_model

Approach: *direct* models predict log(price[t+h] / price[t]) for every horizon
h = 1 .. MAX_HORIZON days. Each training row is an (origin, h) pair: the origin's features
(data <= t only) plus h and the calendar position of the target day. Because every horizon
is predicted directly from data known at the origin, serving needs no recursion and no
forecast of future arrivals, and one model error cannot compound into the next day.

Two target forms are compared for each algorithm:
  * plain: the model predicts the h-day log change y.
  * rate:  the model predicts the average daily change y / h (forecast = h x prediction),
           trained with sample weight h^2 so the loss is still the squared error of the
           h-day change. Leaves then average *rates*, which keeps short-horizon forecasts
           small; the plain form is better at long horizons.
For every horizon the candidate with the lowest CV MAE (pooled over crops, smoothed over
h +- 3 days) is used, so the deployed forecaster may switch model at some horizon.

Validation: expanding-window, rolling-origin CV. Each fold tests one calendar quarter of
2025 forecast origins at all horizons. Training pairs are restricted to those whose *target
date* falls before the test quarter starts, so no future price ever leaks into training.
Data is never shuffled across time.

Baselines: naive (no change), seasonal naive (same change as one year earlier).
Candidates: Random Forest and XGBoost, each in plain and rate form. (Histogram Gradient
Boosting was within 3% of XGBoost in earlier runs and is no longer compared.)

Reliability is then judged per crop and horizon: the API only treats a date as validated
when the selected forecaster beat the naive "no change" forecast there in CV.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

from app.ml.common import paths
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, MODEL_FEATURES,
                                              REPORT_HORIZONS, SERIES_KEY, STATE_MARKET,
                                              compute_features, fit_encoders,
                                              target_log_change, usable_origin_mask,
                                              with_pair_features)

SEED = 42
N_TRAIN_PAIRS = 400_000   # (origin, horizon) pairs sampled per CV fit
N_FINAL_PAIRS = 600_000   # pairs sampled for the final fit
N_TEST_PAIRS = 1_000_000  # pairs sampled per test quarter
RF_MAX_TRAIN_ROWS = 200_000
SMOOTH_DAYS = 3           # per-horizon error statistics pool horizons h-3 .. h+3
MIN_RESIDUAL_SAMPLES = 200
CANDIDATES = {"rf_plain": ("random_forest", "plain"), "rf_rate": ("random_forest", "rate"),
              "xgb_plain": ("xgboost", "plain"), "xgb_rate": ("xgboost", "rate")}
FOLDS = [("2025-Q1", "2025-01-01", "2025-03-31"), ("2025-Q2", "2025-04-01", "2025-06-30"),
         ("2025-Q3", "2025-07-01", "2025-09-30"), ("2025-Q4", "2025-10-01", "2025-12-31")]


def make_model(algorithm: str):
    if algorithm == "random_forest":
        return RandomForestRegressor(n_estimators=120, max_depth=14, min_samples_leaf=20,
                                     max_features=0.5, n_jobs=-1, random_state=SEED)
    return XGBRegressor(n_estimators=500, learning_rate=0.05, max_depth=6, min_child_weight=20,
                        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
                        tree_method="hist", n_jobs=-1, random_state=SEED)


def fit(candidate: str, X: pd.DataFrame, y: np.ndarray):
    algorithm, form = CANDIDATES[candidate]
    if algorithm == "random_forest" and len(X) > RF_MAX_TRAIN_ROWS:
        idx = np.random.default_rng(SEED).choice(len(X), RF_MAX_TRAIN_ROWS, replace=False)
        X, y = X.iloc[idx], y[idx]
    model = make_model(algorithm)
    if form == "rate":
        h = X["horizon_days"].to_numpy(dtype="float64")
        model.fit(X, y / h, sample_weight=h ** 2)
    else:
        model.fit(X, y)
    return model


def predict(candidate: str, model, X: pd.DataFrame) -> np.ndarray:
    pred = model.predict(X)
    if CANDIDATES[candidate][1] == "rate":
        pred = pred * X["horizon_days"].to_numpy()
    return pred.astype("float32")


def price_metrics(p0, y_true_log, y_pred_log) -> dict:
    actual = p0 * np.exp(y_true_log)
    pred = p0 * np.exp(y_pred_log)
    return {
        "MAE": float(mean_absolute_error(actual, pred)),
        "RMSE": float(np.sqrt(mean_squared_error(actual, pred))),
        "R2": float(r2_score(actual, pred)),
        "MAPE_pct": float(np.mean(np.abs(pred - actual) / actual) * 100),
        "R2_change": float(r2_score(y_true_log, y_pred_log)),
        "direction_accuracy_pct": float(np.mean(np.sign(y_pred_log) == np.sign(y_true_log)) * 100),
        "n": int(len(actual)),
    }


def sample(rng, mask: np.ndarray, n: int) -> np.ndarray:
    idx = np.flatnonzero(mask)
    return idx if len(idx) <= n else np.sort(rng.choice(idx, n, replace=False))


def smoothed(values: dict[int, np.ndarray], h: int) -> np.ndarray:
    """Concatenate the arrays of horizons h-SMOOTH_DAYS .. h+SMOOTH_DAYS."""
    parts = [values[k] for k in range(h - SMOOTH_DAYS, h + SMOOTH_DAYS + 1) if k in values]
    return np.concatenate(parts) if parts else np.array([])


def ranges(hs: list[int]) -> str:
    """[1, 2, 3, 7, 8] -> '1-3, 7-8'"""
    out: list[list[int]] = []
    for h in hs:
        if out and h == out[-1][1] + 1:
            out[-1][1] = h
        else:
            out.append([h, h])
    return ", ".join(f"{a}-{b}" for a, b in out) or "none"


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    paths.PRICE_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    encoders = fit_encoders(panel)
    feat = compute_features(panel, encoders, with_targets=True)
    mask = usable_origin_mask(feat).to_numpy()
    base = feat[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    data_end = panel["Date"].max()

    # targets and seasonal-naive baseline for every (origin, horizon) pair
    Y = np.empty((n, H), dtype="float32")
    SN = np.empty((n, H), dtype="float32")
    g = feat.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365)
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(feat, h).to_numpy()[mask]
        SN[:, h - 1] = (g.shift(365 - h) - lag365).fillna(0.0).to_numpy()[mask]
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all, sn_all = Y.ravel(), SN.ravel()
    has_target = ~np.isnan(y_all)
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")
    pair_origin = origin_day[oi]
    pair_target = pair_origin + hh.astype("timedelta64[D]")
    p0_all = np.exp(base["log_price"].to_numpy())
    crop_all = base["Commodity"].to_numpy()
    state_all = (base["Market"] == STATE_MARKET).to_numpy()
    print(f"usable origins: {n:,}  pairs with a target: {has_target.sum():,}  "
          f"({time.time() - t0:.0f}s)")

    def X_of(idx):
        return with_pair_features(base.iloc[oi[idx]], hh[idx])

    oof = []
    for fname, start, end in FOLDS:
        start, end = np.datetime64(start), np.datetime64(end)
        tr = sample(rng, has_target & (pair_target < start), N_TRAIN_PAIRS)
        te = sample(rng, has_target & (pair_origin >= start) & (pair_origin <= end), N_TEST_PAIRS)
        Xtr, ytr, Xte = X_of(tr), y_all[tr], X_of(te)
        preds = {"naive": np.zeros(len(te), dtype="float32"), "seasonal_naive": sn_all[te]}
        for name in CANDIDATES:
            preds[name] = predict(name, fit(name, Xtr, ytr), Xte)
            print(f"{fname} {name}: train={len(tr):,} test={len(te):,} ({time.time() - t0:.0f}s)")
        oof.append(pd.DataFrame({"fold": fname, "horizon": hh[te], "commodity": crop_all[oi[te]],
                                 "is_state": state_all[oi[te]], "p0": p0_all[oi[te]],
                                 "y": y_all[te], **{f"pred_{k}": v for k, v in preds.items()}}))
    oof_df = pd.concat(oof, ignore_index=True)

    # per-horizon choice of candidate: lowest pooled CV MAE, smoothed over h +- SMOOTH_DAYS
    act = oof_df["p0"] * np.exp(oof_df["y"])
    mae_h = pd.DataFrame({c: (oof_df["p0"] * np.exp(oof_df[f"pred_{c}"]) - act).abs()
                          .groupby(oof_df["horizon"]).mean() for c in CANDIDATES})
    smooth = mae_h.rolling(2 * SMOOTH_DAYS + 1, center=True, min_periods=1).mean()
    horizon_models = {int(h): str(c) for h, c in smooth.idxmin(axis=1).items()}
    oof_df["pred_selected"] = np.select(
        [oof_df["horizon"].map(horizon_models) == c for c in CANDIDATES],
        [oof_df[f"pred_{c}"] for c in CANDIDATES])
    blocks: list[list] = []
    for h in HORIZONS:
        if blocks and blocks[-1][2] == horizon_models[h]:
            blocks[-1][1] = h
        else:
            blocks.append([h, h, horizon_models[h]])
    selection = ", ".join(f"{a}-{b}: {c}" for a, b, c in blocks)
    print(f"horizon -> model: {selection}")

    models_compared = ["naive", "seasonal_naive", *CANDIDATES, "selected"]
    fold_rows = []
    for fname, frame in oof_df.groupby("fold"):
        for name in models_compared:
            fold_rows.append({"fold": fname, "model": name, "horizon": "all",
                              **price_metrics(frame["p0"], frame["y"], frame[f"pred_{name}"])})
            for h in REPORT_HORIZONS:
                s = frame[frame["horizon"] == h]
                fold_rows.append({"fold": fname, "model": name, "horizon": h,
                                  **price_metrics(s["p0"], s["y"], s[f"pred_{name}"])})
    folds_df = pd.DataFrame(fold_rows)
    summary = (folds_df.groupby(["horizon", "model"])[["MAE", "RMSE", "R2", "MAPE_pct",
                                                       "R2_change", "direction_accuracy_pct"]]
               .mean())
    print(summary.round(3).to_string())

    # per crop x horizon reliability and empirical error ranges of the selected forecaster
    oof_df["resid"] = oof_df["y"] - oof_df["pred_selected"]
    oof_df["ae_model"] = (oof_df["p0"] * np.exp(oof_df["pred_selected"]) - act).abs()
    oof_df["ae_naive"] = (oof_df["p0"] - act).abs()
    intervals, per_crop = {}, []
    pooled_resid = {h: g["resid"].to_numpy() for h, g in oof_df.groupby("horizon")}
    for h in HORIZONS:
        r = smoothed(pooled_resid, h)
        intervals[str(h)] = {"_all": {"q10": float(np.quantile(r, .10)),
                                      "q90": float(np.quantile(r, .90)),
                                      "median_abs": float(np.median(np.abs(r)))}}
    for crop, cg in oof_df.groupby("commodity"):
        ch = {h: g for h, g in cg.groupby("horizon")}
        resid = {h: g["resid"].to_numpy() for h, g in ch.items()}
        aem = {h: g["ae_model"].to_numpy() for h, g in ch.items()}
        aen = {h: g["ae_naive"].to_numpy() for h, g in ch.items()}
        for h in HORIZONS:
            r = smoothed(resid, h)
            if len(r) >= MIN_RESIDUAL_SAMPLES:
                intervals[str(h)][crop] = {"q10": float(np.quantile(r, .10)),
                                           "q90": float(np.quantile(r, .90)),
                                           "median_abs": float(np.median(np.abs(r))),
                                           "n": int(len(r))}
            m, nv = smoothed(aem, h), smoothed(aen, h)
            raw = ch.get(h)
            per_crop.append({"horizon": h, "commodity": crop, "n": int(len(m)),
                             "model_MAE": float(m.mean()) if len(m) else None,
                             "naive_MAE": float(nv.mean()) if len(nv) else None,
                             "model_MAE_unsmoothed": float(raw["ae_model"].mean()) if raw is not None else None,
                             "naive_MAE_unsmoothed": float(raw["ae_naive"].mean()) if raw is not None else None})
    per_crop_df = pd.DataFrame(per_crop)
    # validated = better than "no change" at exactly h AND pooled over h +- SMOOTH_DAYS
    per_crop_df["beats_naive"] = ((per_crop_df["model_MAE"] < per_crop_df["naive_MAE"]) &
                                  (per_crop_df["model_MAE_unsmoothed"]
                                   < per_crop_df["naive_MAE_unsmoothed"]))
    validated = {}
    for crop, g in per_crop_df.groupby("commodity"):
        ok = g.loc[g["beats_naive"], "horizon"].astype(int).tolist()
        validated[crop] = ranges(ok)
        print(f"{crop:12s} beats naive at {len(ok)}/{MAX_HORIZON} horizons: {validated[crop]}")

    # final models (only candidates used at some horizon) on a sample of all pairs
    fin = sample(rng, has_target, N_FINAL_PAIRS)
    X_fin = X_of(fin)
    model_files, final_models = {}, {}
    for c in sorted(set(horizon_models.values())):
        final_models[c] = fit(c, X_fin, y_all[fin])
        model_files[c] = f"price_model_{c}.joblib"
        joblib.dump(final_models[c], paths.PRICE_MODEL_DIR / model_files[c], compress=3)
        print(f"final {c} fitted ({time.time() - t0:.0f}s)")
    for old in paths.PRICE_MODEL_DIR.glob("price_model*.joblib"):
        if old.name not in model_files.values():
            old.unlink()

    # global SHAP importance on recent origins (each pair explained by its horizon's model)
    recent = has_target & (pair_origin >= np.datetime64("2025-07-01"))
    sh = np.random.default_rng(SEED).choice(np.flatnonzero(recent), 2_000, replace=False)
    X_sh = X_of(sh)
    sv = np.zeros(X_sh.shape)
    for c, m in final_models.items():
        rows = (X_sh["horizon_days"].astype(int).map(horizon_models) == c).to_numpy()
        if rows.any():
            v = np.asarray(shap.TreeExplainer(m).shap_values(X_sh[rows]))
            if CANDIDATES[c][1] == "rate":
                v = v * X_sh.loc[rows, ["horizon_days"]].to_numpy()
            sv[rows] = v
    imp = pd.Series(np.abs(sv).mean(axis=0), index=MODEL_FEATURES).sort_values(ascending=False)

    folds_df.to_csv(paths.PRICE_MODEL_DIR / "cv_fold_metrics.csv", index=False)
    per_crop_df.to_csv(paths.PRICE_MODEL_DIR / "cv_per_crop_metrics.csv", index=False)
    joblib.dump({"encoders": encoders, "feature_columns": MODEL_FEATURES},
                paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")

    def cv(model, h):
        return summary.loc[(h, model)].round(4).to_dict()

    meta = {
        "model_type": "price_prediction",
        "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "approach": "direct multi-horizon (horizon is a feature), no recursion",
        "max_horizon": MAX_HORIZON,
        "horizons": list(HORIZONS),
        "candidates": {c: {"algorithm": a, "target_form": f} for c, (a, f) in CANDIDATES.items()},
        "model_files": model_files,
        "horizon_models": {str(h): c for h, c in horizon_models.items()},
        "data_start": str(panel["Date"].min().date()), "data_end": str(data_end.date()),
        "training_origins": int(n),
        "training_pairs_final": int(len(fin)),
        "target": "log(price[t+h] / price[t])",
        "validation": "expanding-window rolling-origin CV, 4 quarterly folds over 2025, "
                      "training pairs restricted to target dates before the test quarter",
        "selected": {"model": selection,
                     "cv_mean": {str(h): cv("selected", h) for h in ("all", *REPORT_HORIZONS)},
                     "naive_cv_mean": {str(h): cv("naive", h) for h in ("all", *REPORT_HORIZONS)}},
        "validated_horizons": validated,
        "residual_intervals": intervals,
        "global_shap_importance": imp.round(5).to_dict(),
        "commodities": sorted(encoders["commodity"]),
    }
    (paths.PRICE_MODEL_DIR / "metadata.json").write_text(json.dumps(meta, indent=2),
                                                         encoding="utf-8")
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
