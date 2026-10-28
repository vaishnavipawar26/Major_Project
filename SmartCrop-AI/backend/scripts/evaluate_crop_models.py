"""Would a crop-specific model fix the crops the reliability policy blocks (Onion, Potato, Tomato, Wheat)?

Run from backend/:  python -m scripts.evaluate_crop_models

Same chronological protocol as scripts/train_price_model.py: four expanding-window, rolling-origin folds (the quarters of 2025), training
pairs need a target date before the test quarter, same features, same XGBoost "rate" hyper-parameters. Per fold and crop it compares

  pooled           one model for all crops, as deployed (fitted once per fold)
  crop_specific    a model fitted only on that crop's (origin, horizon) pairs
  crop_shrunk      crop_specific forecast moved only HALF-way from "no change" (damped, a standard guard against over-confident changes)
  no_change        the price stays at the origin price
  seasonal_naive   the same change as one year earlier

Adoption rule (fixed before the run, mirrors the policy's +2 % margin): a crop-level model replaces "no forecast" only if its pooled MAE is
at least 2 % lower than no_change's, it is better than no_change in at least 3 of the 4 folds, and in every horizon band (1-7, 8-14, 15-30,
31-60) it is not worse than no_change. This is only the first screen: a passing model must still go through the full policy build
(scripts.build_crop_policy: real-origin and projection backtests) before any forecast is marked validated.

Projection test (the situation the live app is in, because the price records end long before today): origins 2024-03-01..2024-06-30 are
the "reference year"; the forecast for the same calendar date + h days in 2025 is  reference price x 1.05 (inflation, the production
anchor) x exp(model change), scored against the price really reported in 2025. Models are those fitted on pairs with target dates before
2025-01-01. The policy requires the model to beat the starting price (anchor) there by 2 % as well.

Output: dataset/reports/crop_model_eval.json (+ printed table). Nothing in production is touched.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, SERIES_KEY, compute_features, fit_encoders, target_log_change,
                                              usable_origin_mask, with_pair_features)
from scripts.train_price_model import FOLDS, SEED, fit, predict, sample

import argparse
_ap = argparse.ArgumentParser()
_ap.add_argument("--crops", nargs="*", default=["Onion", "Potato", "Tomato", "Wheat"])
_ap.add_argument("--with-2024-h2", action="store_true", help="also test the 2024 Q3/Q4 folds (the policy's validation folds)")
_args, _ = _ap.parse_known_args()
CROPS = _args.crops
if _args.with_2024_h2:
    FOLDS = [("2024-Q3", "2024-07-01", "2024-09-30"), ("2024-Q4", "2024-10-01", "2024-12-31"), *FOLDS]
N_TRAIN_POOLED, N_TRAIN_CROP, N_TEST = 300_000, 120_000, 120_000
BANDS = {"1-7": (1, 7), "8-14": (8, 14), "15-30": (15, 30), "31-60": (31, 60), "all": (1, 60)}
MIN_GAIN, MIN_FOLDS = 0.02, 3


def mae_by_band(p0, y, pred, h):
    actual, forecast = p0 * np.exp(y), p0 * np.exp(pred)
    return {b: float(np.abs(forecast[(h >= lo) & (h <= hi)] - actual[(h >= lo) & (h <= hi)]).mean()) for b, (lo, hi) in BANDS.items()}


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    feat = compute_features(panel, fit_encoders(panel), with_targets=True)
    mask = usable_origin_mask(feat).to_numpy()
    base = feat[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    Y = np.empty((n, H), dtype="float32")
    SN = np.empty((n, H), dtype="float32")
    g = feat.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365)
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(feat, h).to_numpy()[mask]
        SN[:, h - 1] = (g.shift(365 - h) - lag365).fillna(0.0).to_numpy()[mask]
    YP = np.empty((n, H), dtype="float32")        # log(actual price one year + h days later / reference price), for the projection test
    for h in HORIZONS:
        later = feat.groupby(SERIES_KEY, sort=False)["target_price"].shift(-(365 + h))
        YP[:, h - 1] = (np.log(later) - feat["log_price"]).to_numpy()[mask]
    yp_all = YP.ravel()
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all, sn_all = Y.ravel(), SN.ravel()
    ok = ~np.isnan(y_all)
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")[oi]
    target_day = origin_day + hh.astype("timedelta64[D]")
    p0_all = np.exp(base["log_price"].to_numpy())
    crop_of = base["Commodity"].to_numpy()[oi]
    print(f"{n:,} usable origins ({time.time() - t0:.0f}s)")

    def X_of(idx):
        return with_pair_features(base.iloc[oi[idx]], hh[idx])

    res = {c: {k: [] for k in ("pooled", "crop_specific", "crop_shrunk", "no_change", "seasonal_naive")} for c in CROPS}
    proj = {c: {} for c in CROPS}
    for fname, start, end in FOLDS:
        s, e = np.datetime64(start), np.datetime64(end)
        trained = ok & (target_day < s)
        tr = sample(rng, trained, N_TRAIN_POOLED)
        pooled = fit("xgb_rate", X_of(tr), y_all[tr])
        for crop in CROPS:
            is_c = crop_of == crop
            te = sample(rng, ok & is_c & (origin_day >= s) & (origin_day <= e), N_TEST)
            trc = sample(rng, trained & is_c, N_TRAIN_CROP)
            own = fit("xgb_rate", X_of(trc), y_all[trc])
            Xte = X_of(te)
            p_own = predict("xgb_rate", own, Xte)
            preds = {"pooled": predict("xgb_rate", pooled, Xte), "crop_specific": p_own, "crop_shrunk": 0.5 * p_own,
                     "no_change": np.zeros(len(te), dtype="float32"), "seasonal_naive": sn_all[te]}
            for k, p in preds.items():
                res[crop][k].append(mae_by_band(p0_all[oi[te]], y_all[te], p, hh[te]))
            if fname == "2025-Q1":       # fitted on targets < 2025-01-01: also the projection test (reference year 2024)
                pm = ok & is_c & ~np.isnan(yp_all) & (origin_day >= np.datetime64("2024-03-01")) & (origin_day <= np.datetime64("2024-06-30"))
                tp = sample(rng, pm, N_TEST)
                Xp = X_of(tp)
                p0p, ypp, hp = p0_all[oi[tp]], yp_all[tp], hh[tp]
                actual = p0p * np.exp(ypp)
                # the price the user would know at the data end (2024-12-31): not available per pair here, so the anchor is the main baseline
                pp = {"pooled": predict("xgb_rate", pooled, Xp), "crop_specific": predict("xgb_rate", own, Xp)}
                pp["crop_shrunk"] = 0.5 * pp["crop_specific"]
                pp["anchor_x1.05"] = np.zeros(len(tp), dtype="float32")
                for k, pr in pp.items():
                    fc = p0p * 1.05 * np.exp(pr)
                    proj[crop][k] = {b: float(np.abs(fc[(hp >= lo) & (hp <= hi)] - actual[(hp >= lo) & (hp <= hi)]).mean()) for b, (lo, hi) in BANDS.items()}
            print(f"{fname} {crop} done ({time.time() - t0:.0f}s)", flush=True)

    report = {"setup": f"XGBoost rate; pooled {N_TRAIN_POOLED:,} pairs, crop-specific {N_TRAIN_CROP:,}, {N_TEST:,} test pairs per crop and fold; folds = 2025 quarters",
              "crops": {}}
    print(f"\n{'crop':9} {'model':15} " + " ".join(f"{b:>7}" for b in BANDS) + "   skill vs no_change (all)  folds+  adopt")
    for crop, r in res.items():
        report["crops"][crop] = {}
        nc_folds = [f["all"] for f in r["no_change"]]
        for k, folds in r.items():
            mean = {b: float(np.mean([f[b] for f in folds])) for b in BANDS}
            skill = 1 - mean["all"] / np.mean(nc_folds)
            better = int(sum(f["all"] < nf for f, nf in zip(folds, nc_folds)))
            bands_ok = all(mean[b] <= np.mean([f[b] for f in r["no_change"]]) for b in BANDS if b != "all")
            adopt = k in ("crop_specific", "crop_shrunk") and skill >= MIN_GAIN and better >= (MIN_FOLDS if len(nc_folds) <= 4 else 5) and bands_ok
            report["crops"][crop][k] = {"mae": mean, "skill_vs_no_change_pct": round(100 * skill, 2), "folds": [f[0] for f in FOLDS], "mae_by_fold": [round(f["all"], 1) for f in folds], "folds_better": better, "bands_not_worse": bool(bands_ok), "adopt": bool(adopt)}
            print(f"{crop:9} {k:15} " + " ".join(f"{mean[b]:7.1f}" for b in BANDS) + f"   {100 * skill:+6.2f}%   {better}/4   {adopt if k.startswith('crop_') else ''}")
    print("\nprojection test (reference year 2024 -> 2025), MAE and skill vs the x1.05 starting price")
    for crop, d in proj.items():
        a = d["anchor_x1.05"]["all"]
        report["crops"][crop]["projection"] = {k: {"mae": v, "skill_vs_anchor_pct": round(100 * (1 - v["all"] / a), 2)} for k, v in d.items()}
        print(f"{crop:9} " + "  ".join(f"{k}: {v['all']:.1f} ({100 * (1 - v['all'] / a):+.1f}%)" for k, v in d.items()))
    (paths.REPORTS_DIR / ("crop_model_eval_with_2024h2.json" if _args.with_2024_h2 else "crop_model_eval.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote crop_model_eval.json ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
