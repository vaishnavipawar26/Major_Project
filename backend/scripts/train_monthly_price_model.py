"""Stage 5b: train the monthly (selling-month) price forecaster — XGBoost regression.

Run from backend/ after prepare_price_data.py:
    python -m scripts.train_monthly_price_model

Validation (no look-ahead): two forecast-origin cut-offs. For cut-off C the model is trained
only on pairs whose TARGET month is <= C, and tested on pairs whose origin is <= C and whose
target lies in the 6 months after C — i.e. genuine out-of-sample forecasts made with the
information available at C.
    fold 1: C = 2024-12, test targets 2025-01 .. 2025-06
    fold 2: C = 2025-06, test targets 2025-07 .. 2025-12
De-drifting: with only three years of data a real (above-inflation) price trend cannot be
identified — 2023-24 saw sharp rises for some crops and 2025 a crash, and a model that learns
that drift extrapolates it wrongly. So each crop's linear real-price trend over the training
window (fitted on its state-wide series) is subtracted from the target, and no real trend is
projected forward: the only trend in a forecast is the explicit inflation assumption. This
is what made the model beat both baselines in validation (see MODEL_EVALUATION.md).
Baselines: "no real change" (price stays the same apart from inflation) and seasonal naive
(same calendar month in the most recent year, inflation-adjusted).
The deployed model is refitted on all pairs; prediction intervals use the out-of-fold
residual quantiles per horizon bucket.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from app.ml.common import paths
from app.ml.common.reference import CROPS, cities, city_markets
from app.ml.price_prediction.monthly import (BASE_PERIOD, DEFAULT_INFLATION, FEATURES, H_MAX,
                                             STATE_SERIES, SeriesContext, build_monthly_panel,
                                             deflator, series_frame, training_rows)

SEED = 42
MIN_MONTHS = 24              # a series needs this many observed months to be modelled
CUTOFFS = ["2024-12", "2025-06"]
TEST_SPAN = 6
BUCKETS = [(1, 3), (4, 6), (7, 12), (13, 24)]


def bucket_of(h: int) -> str:
    for lo, hi in BUCKETS:
        if lo <= h <= hi:
            return f"{lo}-{hi}"
    raise ValueError(h)


def make_model() -> XGBRegressor:
    return XGBRegressor(n_estimators=300, max_depth=3, learning_rate=0.03, subsample=0.8,
                        colsample_bytree=0.8, min_child_weight=30, reg_lambda=5.0,
                        tree_method="hist", random_state=SEED, n_jobs=-1)


def crop_drifts(panel: pd.DataFrame, end: pd.Period, upto: int, inflation: float) -> dict:
    """Monthly real log-price slope per crop (state series, months 0..upto)."""
    out = {}
    for crop in CROPS:
        st = series_frame(panel, STATE_SERIES, crop, end)
        lr = np.log(st["price"].to_numpy() / deflator(st["t"].to_numpy(), inflation))[:upto + 1]
        t = np.arange(len(lr))
        ok = ~np.isnan(lr)
        out[crop] = float(np.polyfit(t[ok], lr[ok], 1)[0])
    return out


def dedrifted_target(df: pd.DataFrame, drifts: dict) -> pd.Series:
    return df["y"] - df["crop"].map(drifts) * df["horizon"]


def metrics(df: pd.DataFrame, col: str) -> dict:
    d = df.dropna(subset=[col])
    infl = deflator(d["horizon"].to_numpy(), d.attrs["inflation"])
    pred = d["origin_price_nominal"].to_numpy() * np.exp(d[col].to_numpy()) * infl
    act = d["target_price_nominal"].to_numpy()
    err = pred - act
    return {"n": int(len(d)), "MAE": float(np.abs(err).mean()),
            "MAPE_pct": float((np.abs(err) / act).mean() * 100),
            "direction_accuracy_pct": float((np.sign(d[col]) == np.sign(d["y"])).mean() * 100)}


def main() -> None:
    out = paths.MONTHLY_PRICE_MODEL_DIR
    out.mkdir(parents=True, exist_ok=True)
    inflation = DEFAULT_INFLATION
    city_list = list(cities())

    clean = pd.read_parquet(paths.PRICE_CLEAN_PATH)
    panel = build_monthly_panel(clean, city_markets())
    panel.to_csv(paths.MONTHLY_PANEL_PATH, index=False)
    end = pd.Period(clean["Date"].max(), freq="M")

    series_codes = {c: i for i, c in enumerate(city_list)} | {STATE_SERIES: len(city_list)}
    crop_codes = {c: i for i, c in enumerate(CROPS)}
    rows, coverage = [], []
    for crop in CROPS:
        state = series_frame(panel, STATE_SERIES, crop, end)
        for series, code in series_codes.items():
            frame = series_frame(panel, series, crop, end)
            observed = int(frame["price"].notna().sum())
            coverage.append({"series": series, "crop": crop, "observed_months": observed,
                             "modelled": observed >= MIN_MONTHS})
            if observed < MIN_MONTHS:
                continue
            ctx = SeriesContext(frame, state, inflation, crop_codes[crop], code)
            r = training_rows(ctx)
            r["series"], r["crop"] = series, crop
            rows.append(r)
    data = pd.concat(rows, ignore_index=True)
    data.attrs["inflation"] = inflation
    print(f"{len(data)} training pairs from {sum(c['modelled'] for c in coverage)} series")

    # ------------------------------------------------------------------ validation
    fold_rows, oof = [], []
    for cutoff in CUTOFFS:
        c = (pd.Period(cutoff, freq="M") - BASE_PERIOD).n
        train = data[data["target_t"] <= c]
        test = data[(data["origin_t"] <= c) & (data["target_t"] > c)
                    & (data["target_t"] <= c + TEST_SPAN)].copy()
        test.attrs["inflation"] = inflation
        drifts = crop_drifts(panel, end, c, inflation)
        model = make_model().fit(train[FEATURES], dedrifted_target(train, drifts))
        test["model_y"] = model.predict(test[FEATURES])
        test["naive_y"] = 0.0
        test["bucket"] = test["horizon"].map(bucket_of)
        test["cutoff"] = cutoff
        oof.append(test)
        for b, g in [("all", test), *test.groupby("bucket")]:
            g.attrs["inflation"] = inflation
            fold_rows.append({"cutoff": cutoff, "bucket": b,
                              **{f"model_{k}": v for k, v in metrics(g, "model_y").items()},
                              **{f"naive_{k}": v for k, v in metrics(g, "naive_y").items()
                                 if k != "n"},
                              **{f"seasonal_naive_{k}": v
                                 for k, v in metrics(g, "seasonal_naive_y").items()
                                 if k != "n"}})
    folds = pd.DataFrame(fold_rows)
    folds.round(3).to_csv(out / "cv_fold_metrics.csv", index=False)
    oof = pd.concat(oof, ignore_index=True)
    oof.attrs["inflation"] = inflation

    summary = {}
    for b, g in [("all", oof), *oof.groupby("bucket")]:
        g.attrs["inflation"] = inflation
        summary[b] = {"model": metrics(g, "model_y"), "naive": metrics(g, "naive_y"),
                      "seasonal_naive": metrics(g, "seasonal_naive_y")}
        print(f"h {b:>6}: model MAE {summary[b]['model']['MAE']:7.1f}  "
              f"naive {summary[b]['naive']['MAE']:7.1f}  "
              f"seasonal-naive {summary[b]['seasonal_naive']['MAE']:7.1f}  "
              f"(MAPE model {summary[b]['model']['MAPE_pct']:.1f}%)")

    per_crop = []
    for crop, g in oof.groupby("crop"):
        g.attrs["inflation"] = inflation
        m, n = metrics(g, "model_y"), metrics(g, "naive_y")
        per_crop.append({"crop": crop, "model_MAE": m["MAE"], "naive_MAE": n["MAE"],
                         "model_MAPE_pct": m["MAPE_pct"], "n": m["n"]})
    pd.DataFrame(per_crop).round(2).to_csv(out / "cv_per_crop_metrics.csv", index=False)

    resid = oof["y"] - oof["model_y"]
    intervals = {}
    for b, g in resid.groupby(oof["bucket"]):
        intervals[b] = {"q10": float(g.quantile(.10)), "q90": float(g.quantile(.90)),
                        "median_abs": float(g.abs().median()), "n": int(len(g))}

    # ------------------------------------------------------------------ final model
    all_drifts = crop_drifts(panel, end, (end - BASE_PERIOD).n, inflation)
    final = make_model().fit(data[FEATURES], dedrifted_target(data, all_drifts))
    joblib.dump(final, out / "monthly_price_model.joblib", compress=3)
    imp = dict(zip(FEATURES, np.round(final.feature_importances_.astype(float), 4).tolist()))

    meta = {"model_type": "monthly_price", "algorithm": "xgboost_regressor",
            "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "target": "log(real price[t+h] / real price[t]), h = 1..24 months",
            "inflation_annual": inflation,
            "inflation_note": "Assumed constant annual inflation used to deflate prices for "
                              "training and to re-inflate forecasts.",
            "data_start": str(BASE_PERIOD), "data_end": str(end), "h_max": H_MAX,
            "features": FEATURES, "cities": city_list, "crops": list(CROPS),
            "series_codes": series_codes, "crop_codes": crop_codes,
            "historical_real_trend_pct_per_year": {
                k: round((np.exp(v * 12) - 1) * 100, 2) for k, v in all_drifts.items()},
            "trend_note": "Historical real trend per crop (2023-2025), removed from the target "
                          "and NOT projected forward.",
            "min_months": MIN_MONTHS, "coverage": coverage,
            "validation": "2 time-ordered cut-offs (2024-12, 2025-06), 6-month test windows",
            "cv_summary": summary, "intervals": intervals, "feature_importance": imp,
            "training_pairs": int(len(data))}
    (out / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("saved ->", out)


if __name__ == "__main__":
    main()
