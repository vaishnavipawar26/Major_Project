"""Honest walk-forward comparison: price-only features vs price + weather features.

Run from backend/ (after prepare_price_data, build_market_locations, fetch_price_weather,
build_weather_features):   python -m scripts.evaluate_price_models

Protocol
--------
* Four quarterly walk-forward folds over 2025. For each fold the models are fitted ONLY on
  (origin, horizon) pairs whose *target date* is before the fold starts, then predict every
  origin inside the fold. Nothing is shuffled across time.
* VALIDATION folds = 2025-Q1, Q2.  TEST folds = 2025-Q3, Q4.
  Model choice per horizon band and the prediction-interval calibration use validation
  folds only; test folds are scored once afterwards with those frozen choices.
* Both feature sets are fitted on exactly the same rows with the same hyper-parameters.
* Weather features contain only information known at the origin (see weather_features.py).

Metrics (price space, Rs/quintal; err = predicted - actual price at the target date)
  MAE   mean |err|                        RMSE  sqrt(mean err^2)
  WAPE  sum |err| / sum actual            (weighted absolute % error; stable near zero prices)
  Direction accuracy: share of cases where the sign of the predicted change equals the sign
        of the actual change, among cases where the actual price moved by more than 1 %.
  Skill vs no-change: 1 - MAE_model / MAE_nochange  (positive = better than "price stays the same").
MAPE is not reported as a headline because it explodes when an actual price is near zero.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, MODEL_FEATURES, SERIES_KEY,
                                              STATE_MARKET, compute_features, fit_encoders,
                                              target_log_change, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_prediction.weather_features import WEATHER_FEATURES, attach
from scripts.train_price_model import CANDIDATES, SEED, fit, predict, sample

SMOKE = os.getenv("EVAL_SMOKE") == "1"   # tiny run to check the code path; results are meaningless
N_TRAIN_PAIRS = 20_000 if SMOKE else 400_000
N_TEST_PAIRS = 20_000 if SMOKE else 400_000
EVAL_CANDIDATES = ["xgb_rate", "rf_rate", "rf_plain"]
BANDS = {"1-7": (1, 7), "8-14": (8, 14), "15-30": (15, 30), "31-60": (31, 60)}
EXACT = (1, 7, 14, 30, 60)
VALIDATION = [("2025-Q1", "2025-01-01", "2025-03-31"), ("2025-Q2", "2025-04-01", "2025-06-30")]
TEST = [("2025-Q3", "2025-07-01", "2025-09-30"), ("2025-Q4", "2025-10-01", "2025-12-31")]
FEATURE_SETS = {"price_only": MODEL_FEATURES, "price_weather": MODEL_FEATURES + WEATHER_FEATURES}
WEATHER_FEATURES_PATH = Path(os.getenv("WEATHER_FEATURES_PATH",
                             paths.DATASET_DIR / "weather" / "weather_features_daily.parquet"))
OUT_DIR = Path(os.getenv("EVAL_OUT_DIR", paths.REPORTS_DIR))


def band_of(h: np.ndarray) -> np.ndarray:
    out = np.full(len(h), "", dtype=object)
    for name, (a, b) in BANDS.items():
        out[(h >= a) & (h <= b)] = name
    return out


def with_pair_features_w(origins: pd.DataFrame, horizons) -> pd.DataFrame:
    X = with_pair_features(origins, horizons)
    for c in WEATHER_FEATURES:
        X[c] = origins[c].astype("float32").to_numpy()
    return X


def metrics(p0, y, pred) -> dict:
    actual, fc = p0 * np.exp(y), p0 * np.exp(pred)
    err = fc - actual
    moved = np.abs(np.expm1(y)) > 0.01
    return {"n": int(len(actual)), "MAE": float(np.abs(err).mean()),
            "RMSE": float(np.sqrt((err ** 2).mean())),
            "WAPE_pct": float(np.abs(err).sum() / actual.sum() * 100),
            "direction_acc_pct": float((np.sign(pred[moved]) == np.sign(y[moved])).mean() * 100)
            if moved.any() else None}


def table(df: pd.DataFrame, pred_col: str, by: list[str]) -> pd.DataFrame:
    rows = []
    for key, g in df.groupby(by, observed=True):
        key = key if isinstance(key, tuple) else (key,)
        m = metrics(g["p0"].to_numpy(), g["y"].to_numpy(), g[pred_col].to_numpy())
        base = metrics(g["p0"].to_numpy(), g["y"].to_numpy(), np.zeros(len(g)))
        rows.append({**dict(zip(by, key)), **m, "nochange_MAE": base["MAE"],
                     "skill_vs_nochange_pct": (1 - m["MAE"] / base["MAE"]) * 100})
    return pd.DataFrame(rows)


def md(df: pd.DataFrame) -> str:
    rows = ["| " + " | ".join(df.columns) + " |", "|" + "---|" * len(df.columns)]
    for r in df.itertuples(index=False):
        rows.append("| " + " | ".join(f"{v:,.2f}" if isinstance(v, float) else str(v) for v in r) + " |")
    return "\n".join(rows)


def write_markdown(summary: dict, tables: dict, coverage: pd.DataFrame) -> None:
    keep = ["model", "n", "MAE", "RMSE", "WAPE_pct", "direction_acc_pct", "skill_vs_nochange_pct"]
    show = ["no_change", "seasonal_naive", "price_only|selected", "price_weather|selected"]
    L = ["# Price Model Evaluation (walk-forward, 2025)", "",
         f"Generated {summary['generated']} by `scripts/evaluate_price_models.py`.", "",
         f"Status: **{summary['status']}**. Validation folds {summary['validation_folds']}; "
         f"test folds {summary['test_folds']} (all tables below are TEST unless stated).", "",
         "Metric definitions: MAE = mean |forecast - actual| (Rs/quintal); RMSE = root mean squared error; "
         "WAPE = sum|error| / sum(actual) (a weighted percentage error that stays defined when single prices "
         "are small; MAPE is avoided because it explodes near zero); direction accuracy = share of cases with a "
         "price move above 1% where the forecast had the right sign; skill vs no-change = 1 - MAE / MAE of "
         "'price stays the same' (positive = better than no change).", "",
         "Weather features: trailing observed weather and pre-2023 normals only (no forecasts).", ""]
    for title, key, by in (("Overall", "overall", []), ("By forecast-horizon band", "band", ["band"]),
                           ("By exact horizon", "horizon", ["horizon"]), ("By crop", "commodity", ["commodity"])):
        t = tables[key]
        t = t[t["model"].isin(show)]
        cols = by + [c for c in keep if c in t.columns]
        if "all" in t.columns:
            t = t.drop(columns="all")
        L += [f"## {title}", "", md(t[[c for c in cols if c in t.columns]].sort_values(by + ["model"] if by else ["model"])), ""]
    L += ["## Paired comparison on identical test rows (price-only MAE minus weather MAE; positive = weather better)", "",
          "```json", json.dumps(summary["paired_weather_vs_price_only_on_test"], indent=1), "```", "",
          "The standard error treats rows as independent, but rows from the same origin and market are correlated, so "
          "it is optimistic: a gain smaller than about 2 naive standard errors should be read as no evidence of improvement.", "",
          "## 80% prediction-interval coverage (calibrated on validation, scored on test)", "", md(coverage.round(2)), "",
          "## Model chosen per horizon band (validation only)", "", "```json",
          json.dumps(summary["selected_candidate_per_band_from_validation"], indent=1), "```"]
    (OUT_DIR / "price_model_evaluation.md").write_text("\n".join(L), encoding="utf-8")


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    encoders = fit_encoders(panel)
    feat = compute_features(panel, encoders, with_targets=True)
    wf = pd.read_parquet(WEATHER_FEATURES_PATH)
    feat = attach(feat, wf)
    mask = usable_origin_mask(feat).to_numpy()
    base = feat[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    has_weather_origin = base[WEATHER_FEATURES].notna().all(axis=1).to_numpy()
    print(f"origins={n:,}; with full weather={has_weather_origin.mean():.1%}", flush=True)

    Y = np.empty((n, H), dtype="float32")
    SN = np.empty((n, H), dtype="float32")   # seasonal naive: the change seen one year earlier
    g = feat.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365)
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(feat, h).to_numpy()[mask]
        SN[:, h - 1] = (g.shift(365 - h) - lag365).fillna(0.0).to_numpy()[mask]
    sn_all = SN.ravel()
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all = Y.ravel()
    has_target = ~np.isnan(y_all)
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")
    pair_origin = origin_day[oi]
    pair_target = pair_origin + hh.astype("timedelta64[D]")
    p0_all = np.exp(base["log_price"].to_numpy())
    crop_all = base["Commodity"].to_numpy()
    market_all = base["Market"].to_numpy()

    def X_of(idx, cols):
        X = with_pair_features_w(base.iloc[oi[idx]], hh[idx])
        return X[cols]

    frames = []
    for role, folds in (("validation", VALIDATION), ("test", TEST)):
        for fname, start, end in folds:
            s, e = np.datetime64(start), np.datetime64(end)
            tr = sample(rng, has_target & (pair_target < s), N_TRAIN_PAIRS)
            te = sample(rng, has_target & (pair_origin >= s) & (pair_origin <= e), N_TEST_PAIRS)
            out = pd.DataFrame({"role": role, "fold": fname, "horizon": hh[te],
                                "commodity": crop_all[oi[te]], "market": market_all[oi[te]],
                                "has_weather": has_weather_origin[oi[te]],
                                "p0": p0_all[oi[te]], "y": y_all[te],
                                "seasonal_naive": sn_all[te]})
            for fs, cols in FEATURE_SETS.items():
                Xtr, Xte = X_of(tr, cols), X_of(te, cols)
                for c in EVAL_CANDIDATES:
                    out[f"{fs}|{c}"] = predict(c, fit(c, Xtr, y_all[tr]), Xte)
                    print(f"{fname} {fs} {c} train={len(tr):,} test={len(te):,} "
                          f"({time.time() - t0:.0f}s)", flush=True)
            frames.append(out)
    oof = pd.concat(frames, ignore_index=True)
    oof["band"] = band_of(oof["horizon"].to_numpy())
    oof["zero"] = np.float32(0.0)

    # --- freeze choices on VALIDATION only: best candidate per band for each feature set
    val = oof[oof["role"] == "validation"]
    choice = {}
    for fs in FEATURE_SETS:
        choice[fs] = {}
        for band, g in val.groupby("band"):
            maes = {c: np.abs(g["p0"] * (np.exp(g[f"{fs}|{c}"]) - np.exp(g["y"]))).mean()
                    for c in EVAL_CANDIDATES}
            choice[fs][band] = min(maes, key=maes.get)
    for fs in FEATURE_SETS:
        oof[f"{fs}|selected"] = np.select(
            [oof["band"] == b for b in BANDS], [oof[f"{fs}|{choice[fs][b]}"] for b in BANDS])
    oof["resid_price_only"] = oof["y"] - oof["price_only|selected"]
    oof["resid_price_weather"] = oof["y"] - oof["price_weather|selected"]

    # --- 80 % interval calibrated on validation residuals per band, scored on test
    intervals = {}
    cov_rows = []
    for fs, rcol in (("price_only", "resid_price_only"), ("price_weather", "resid_price_weather")):
        v = oof[oof["role"] == "validation"]
        q = v.groupby("band")[rcol].quantile([0.1, 0.9]).unstack()
        intervals[fs] = {b: {"q10": float(q.loc[b, 0.1]), "q90": float(q.loc[b, 0.9])} for b in q.index}
        t = oof[oof["role"] == "test"]
        lo = t["band"].map(lambda b: intervals[fs][b]["q10"])
        hi = t["band"].map(lambda b: intervals[fs][b]["q90"])
        pred = t[f"{fs}|selected"]
        inside = (t["y"] >= pred + lo) & (t["y"] <= pred + hi)
        width = t["p0"] * (np.exp(pred + hi) - np.exp(pred + lo))
        d = pd.DataFrame({"feature_set": fs, "band": t["band"], "commodity": t["commodity"],
                          "inside": inside, "width": width, "rel_width_pct": width / (t["p0"] * np.exp(pred)) * 100})
        for key, g in d.groupby(["band"]):
            cov_rows.append({"feature_set": fs, "by": "band", "key": key[0], "n": len(g),
                             "coverage_pct": g["inside"].mean() * 100, "mean_width_rs": g["width"].mean(),
                             "mean_rel_width_pct": g["rel_width_pct"].mean()})
        for key, g in d.groupby("commodity"):
            cov_rows.append({"feature_set": fs, "by": "commodity", "key": key, "n": len(g),
                             "coverage_pct": g["inside"].mean() * 100, "mean_width_rs": g["width"].mean(),
                             "mean_rel_width_pct": g["rel_width_pct"].mean()})
    coverage = pd.DataFrame(cov_rows)

    # --- test-set tables
    test = oof[oof["role"] == "test"]
    cols = ["zero", "seasonal_naive", "price_only|selected", "price_weather|selected",
            *[f"{fs}|{c}" for fs in FEATURE_SETS for c in EVAL_CANDIDATES]]
    names = {"zero": "no_change", "seasonal_naive": "seasonal_naive"}
    res = {}
    for pc in cols:
        for by in (["band"], ["horizon"], ["commodity"], []):
            if by == ["horizon"]:
                t = test[test["horizon"].isin(EXACT)]
            else:
                t = test
            if by == []:
                t = t.assign(all="all"); keys = ["all"]
            else:
                keys = by
            tb = table(t, pc, keys); tb.insert(0, "model", names.get(pc, pc))
            res.setdefault("_".join(by) or "overall", []).append(tb)
    tables = {k: pd.concat(v, ignore_index=True) for k, v in res.items()}

    # weather-covered vs weather-missing origins (same test rows)
    cov_split = []
    for hw, g in test.groupby("has_weather"):
        for pc in ("price_only|selected", "price_weather|selected"):
            m = table(g.assign(all="all"), pc, ["all"]); m.insert(0, "model", pc)
            m.insert(1, "origin_has_weather", bool(hw)); cov_split.append(m)
    tables["by_weather_coverage"] = pd.concat(cov_split, ignore_index=True)
    # paired comparison: weather vs price-only absolute error on the same test rows
    ae_po = (test["p0"] * (np.exp(test["price_only|selected"]) - np.exp(test["y"]))).abs()
    ae_pw = (test["p0"] * (np.exp(test["price_weather|selected"]) - np.exp(test["y"]))).abs()
    diff = (ae_po - ae_pw)
    paired = {}
    for b, idx in test.groupby("band").groups.items():
        d = diff.loc[idx]
        # block bootstrap by origin quarter-week is overkill; report mean +- 2 s.e. (rows are correlated => optimistic)
        paired[b] = {"mean_MAE_gain_rs": float(d.mean()), "naive_se_rs": float(d.std() / np.sqrt(len(d))),
                     "share_rows_improved_pct": float((d > 0).mean() * 100)}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for k, v in tables.items():
        v.to_csv(OUT_DIR / f"price_eval_test_{k}.csv", index=False)
    coverage.to_csv(OUT_DIR / "price_eval_interval_coverage.csv", index=False)
    summary = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "validation folds used for selection/calibration; test folds scored once",
        "validation_folds": [f[0] for f in VALIDATION], "test_folds": [f[0] for f in TEST],
        "feature_sets": {k: v for k, v in FEATURE_SETS.items()},
        "weather_feature_note": "trailing observed weather + pre-2023 normals; no forecast data",
        "selected_candidate_per_band_from_validation": choice,
        "interval_q_from_validation": intervals,
        "paired_weather_vs_price_only_on_test": paired,
        "origin_share_with_full_weather": float(has_weather_origin.mean()),
        "n_test_pairs": int(len(test)), "n_validation_pairs": int((oof["role"] == "validation").sum()),
    }
    (OUT_DIR / "price_eval_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_markdown(summary, tables, coverage)
    print(json.dumps(summary["selected_candidate_per_band_from_validation"], indent=1))
    pd.set_option("display.width", 200)
    print(tables["band"][["model", "band", "n", "MAE", "RMSE", "WAPE_pct", "direction_acc_pct",
                          "skill_vs_nochange_pct"]].round(2).to_string())
    print(json.dumps(paired, indent=1))
    print(f"done {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
