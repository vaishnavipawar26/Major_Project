"""Do weather and soil improve the daily price forecaster? A like-for-like test, run before any such input is adopted.

Run from backend/:  python -m scripts.evaluate_environment_features

Every variant is the production XGBoost "rate" model (same hyper-parameters and seed) fitted on exactly the same (origin, horizon) pairs in
the same expanding-window, rolling-origin folds as scripts/train_price_model.py (the four quarters of 2025; training pairs need a target
date before the test quarter, so nothing after the test quarter starts is ever trained on). Variants:

  baseline            the deployed feature set
  +temperature        temp_mean_7, temp_anom_7                       (trailing observed weather at the selling market's town)
  +rainfall           precip_sum_7, precip_sum_30, precip_ratio_30
  +humidity           humidity_mean_7
  +weather            all six trailing weather features
  +climate_at_target  the NORMAL temperature and 30-day rainfall for the target date (normals from years <= 2022 only: known in advance,
                      aligned to the prediction horizon, no future observation)
  +weather+climate    both of the above
  +soil               soil_ph, soil_class_code of the selling market's town (only if dataset/soil/market_soil.csv exists)
  +all                weather + climate + soil

No weather after the forecast origin is read. Weather and soil describe the SELLING MARKET's town: the price data has no growing location,
so a growing location cannot be a trained input. Reference: "no change" (the price stays at the origin price).

Adoption rule, fixed before looking at results: a variant may replace the deployed features only if its pooled MAE AND RMSE (all 1-60 days)
are each at least 2 % lower than the baseline's, its MAE is lower in at least 3 of the 4 folds, and it is not worse than the baseline by
more than 2 % in any fold.

Output: dataset/reports/environment_feature_eval.json (+ a printed table). Nothing in production is touched.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction import soil_features
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, compute_features, fit_encoders, target_log_change,
                                              usable_origin_mask, with_pair_features)
from app.ml.price_prediction.weather_features import WEATHER_FEATURES, add_state_series, attach, normals
from scripts.train_price_model import FOLDS, SEED, fit, predict, sample

N_TRAIN, N_TEST = 250_000, 200_000
BUCKETS = {"1-7": (1, 7), "8-14": (8, 14), "15-30": (15, 30), "31-60": (31, 60), "all": (1, 60)}
GROUPS = {"temperature": ["temp_mean_7", "temp_anom_7"], "rainfall": ["precip_sum_7", "precip_sum_30", "precip_ratio_30"],
          "humidity": ["humidity_mean_7"]}
CLIMATE = ["target_temp_normal", "target_precip30_normal"]
MIN_GAIN, MIN_FOLDS, MAX_FOLD_LOSS = 0.02, 3, 0.02


def climate_tables(weather_path):
    """Per market: normal daily temperature (365) and the normal rainfall of the 30 days ending on each day of the year (365)."""
    nrm = normals(add_state_series(pd.read_parquet(weather_path)))
    names = sorted(nrm)
    temp = np.vstack([nrm[m]["temp"] for m in names]).astype("float32")
    precip = np.vstack([nrm[m]["precip"] for m in names])
    p30 = np.vstack([np.convolve(np.concatenate([r[-29:], r]), np.ones(30), mode="valid") for r in precip]).astype("float32")
    return {m: i for i, m in enumerate(names)}, temp, p30


def scores(p0, y, pred, h):
    out = {}
    actual, forecast = p0 * np.exp(y), p0 * np.exp(pred)
    for name, (a, b) in BUCKETS.items():
        m = (h >= a) & (h <= b)
        err = forecast[m] - actual[m]
        out[name] = {"MAE": float(np.abs(err).mean()), "RMSE": float(np.sqrt((err ** 2).mean())), "n": int(m.sum())}
    return out


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    feat = compute_features(panel, fit_encoders(panel), with_targets=True)
    wpath = paths.DATASET_DIR / "weather"
    feat = attach(feat, pd.read_parquet(wpath / "weather_features_daily.parquet"))
    soil = soil_features.load(paths.DATASET_DIR / "soil" / "market_soil.csv")
    if soil is not None:
        feat = soil_features.attach(feat, soil)
    mask = usable_origin_mask(feat).to_numpy()
    base = feat[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    midx, temp_n, p30_n = climate_tables(wpath / "market_weather_daily.parquet")
    mrow = base["Market"].map(midx).to_numpy(dtype="float64")          # NaN: market without weather history
    soil_cols = soil_features.SOIL_FEATURES if soil is not None else []
    print(f"usable origins {n:,}; complete trailing weather {base[WEATHER_FEATURES].notna().all(axis=1).mean():.1%}; "
          f"soil table: {'%d markets' % len(soil) if soil is not None else 'NOT AVAILABLE (SoilGrids could not be reached)'}  ({time.time() - t0:.0f}s)")

    Y = np.empty((n, H), dtype="float32")
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(feat, h).to_numpy()[mask]
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all = Y.ravel()
    ok = ~np.isnan(y_all)
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")[oi]
    target_day = origin_day + hh.astype("timedelta64[D]")
    p0_all = np.exp(base["log_price"].to_numpy())
    doy_all = pd.DatetimeIndex(target_day).dayofyear.to_numpy()

    variants = {"baseline": [], "+temperature": GROUPS["temperature"], "+rainfall": GROUPS["rainfall"], "+humidity": GROUPS["humidity"],
                "+weather": WEATHER_FEATURES, "+climate_at_target": CLIMATE, "+weather+climate": WEATHER_FEATURES + CLIMATE}
    if soil is not None:
        variants |= {"+soil": soil_cols, "+all": WEATHER_FEATURES + CLIMATE + soil_cols}

    def X_of(idx, extra):
        X = with_pair_features(base.iloc[oi[idx]], hh[idx]).drop(columns=[c for c in WEATHER_FEATURES if c in base.columns], errors="ignore")
        r, d = mrow[oi[idx]], np.minimum(doy_all[idx], 365) - 1
        have = ~np.isnan(r)
        ri = np.where(have, r, 0).astype(int)
        for c in extra:
            if c == "target_temp_normal":
                X[c] = np.where(have, temp_n[ri, d], np.nan).astype("float32")
            elif c == "target_precip30_normal":
                X[c] = np.where(have, p30_n[ri, d], np.nan).astype("float32")
            else:
                X[c] = base[c].to_numpy()[oi[idx]]
        return X

    rows = {k: [] for k in variants}
    rows["no_change"] = []
    for fname, start, end in FOLDS:
        s, e = np.datetime64(start), np.datetime64(end)
        tr = sample(rng, ok & (target_day < s), N_TRAIN)
        te = sample(rng, ok & (origin_day >= s) & (origin_day <= e), N_TEST)
        frame = lambda pred: pd.DataFrame({"p0": p0_all[oi[te]], "y": y_all[te], "pred": pred, "h": hh[te], "fold": fname})  # noqa: E731
        rows["no_change"].append(frame(np.zeros(len(te), dtype="float32")))
        for key, extra in variants.items():
            rows[key].append(frame(predict("xgb_rate", fit("xgb_rate", X_of(tr, extra), y_all[tr]), X_of(te, extra))))
            print(f"{fname} {key} done ({time.time() - t0:.0f}s)")

    report = {"setup": f"XGBoost rate model, {N_TRAIN:,} train / {N_TEST:,} test pairs per fold, 4 quarterly folds of 2025",
              "features": {k: v for k, v in variants.items()}, "soil_table_available": soil is not None,
              "weather_market_coverage": f"{len(midx)} markets with weather history (of {panel['Market'].nunique()} in the price data)",
              "results": {}, "by_fold": {}}
    for key, parts in rows.items():
        d = pd.concat(parts)
        report["results"][key] = scores(d["p0"].to_numpy(), d["y"].to_numpy(), d["pred"].to_numpy(), d["h"].to_numpy())
        report["by_fold"][key] = {f: scores(g["p0"].to_numpy(), g["y"].to_numpy(), g["pred"].to_numpy(), g["h"].to_numpy())["all"]
                                  for f, g in d.groupby("fold")}
    b = report["results"]["baseline"]["all"]
    report["decision"] = {}
    for key in variants:
        if key == "baseline":
            continue
        r = report["results"][key]["all"]
        folds = [(report["by_fold"][key][f]["MAE"] / report["by_fold"]["baseline"][f]["MAE"] - 1) for f in report["by_fold"]["baseline"]]
        gain_mae, gain_rmse = 1 - r["MAE"] / b["MAE"], 1 - r["RMSE"] / b["RMSE"]
        adopt = gain_mae >= MIN_GAIN and gain_rmse >= MIN_GAIN and sum(x < 0 for x in folds) >= MIN_FOLDS and max(folds) <= MAX_FOLD_LOSS
        report["decision"][key] = {"MAE_gain_pct": round(100 * gain_mae, 2), "RMSE_gain_pct": round(100 * gain_rmse, 2),
                                   "folds_improved": int(sum(x < 0 for x in folds)), "worst_fold_change_pct": round(100 * max(folds), 2), "adopt": bool(adopt)}
    out = paths.DATASET_DIR / "reports" / "environment_feature_eval.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{'variant':20} {'MAE':>7} {'RMSE':>7} {'MAE gain':>9} {'RMSE gain':>10} {'folds+':>7} {'worst fold':>11}  adopt")
    for key in ["no_change", "baseline", *[k for k in variants if k != "baseline"]]:
        r = report["results"][key]["all"]
        d = report["decision"].get(key)
        print(f"{key:20} {r['MAE']:7.1f} {r['RMSE']:7.1f} " + (f"{d['MAE_gain_pct']:8.2f}% {d['RMSE_gain_pct']:9.2f}% {d['folds_improved']:>5}/4 {d['worst_fold_change_pct']:+10.2f}%  {d['adopt']}" if d else ""))
    print(f"wrote {out}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
