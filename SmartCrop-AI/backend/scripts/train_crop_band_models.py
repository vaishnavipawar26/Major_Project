"""Train and validate the crop-specific, horizon-band-specific models that the model searches found to beat their baselines.

Run from backend/:   python -m scripts.train_crop_band_models

The cells below come from dataset/reports/forecast_v3_experiment.md (and hard_crops_experiment.md / forecast_v2_experiment.md). For each cell the
rule is re-checked here and a model is saved ONLY if it beats its baseline by at least the project's 2 % margin in all three chronological splits,
in BOTH scenarios:

  real origin   baseline = price stays the same         (the forecast starts from a fresh report)
  projection    baseline = reference price x 1.05       (how the app serves every request while records end in 2025)

  fold C  train targets < 2024-07-01, score origins 2024-07 .. 2024-12
  fold A  train targets < 2025-01-01, score origins 2025-01 .. 2025-06   (also calibrates the 10 % / 90 % error quantiles)
  test T  train targets < 2025-07-01, score origins 2025-07 .. 2025-12   (the range coverage is measured here with fold A's quantiles)

The deployed model of a cell is the same recipe fitted on all data up to 2025-12-31 (nothing later exists). Families:
  xgb       crop-specific XGBoost on the production inputs (minus the crop code), change scaled by a fixed factor
  ma_ridge  ridge regression on moving-average gaps only (app.ml.price_prediction.band_models), change scaled by a LEARNED factor
  yoy_xgb   XGBoost with one extra input (log price now minus log price 365 days earlier), change scaled by a LEARNED factor
A learned factor is fitted on the training data only (scripts.experiment_forecast_v2.learned_factor).
Output: trained_models/price_prediction/crop_band_models.joblib and .json.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.band_models import MA_FEATURES, MovingAverageRidge
from app.ml.price_prediction.features import SERIES_KEY
from scripts.experiment_forecast_v2 import learned_factor
from scripts.experiment_forecast_v3 import SUBBANDS, build, xgb
from scripts.experiment_hard_crops import FEATURES, LEVEL, MARGIN_PCT, SEED, SPLITS, fit_xgb, load, log

MAX_TRAIN = 150_000
CELLS = [
    {"crop": "Wheat", "band": "1-7", "family": "xgb", "shrink": 0.5},
    {"crop": "Wheat", "band": "8-14", "family": "ma_ridge", "shrink": "learned"},
    {"crop": "Wheat", "band": "15-21", "family": "ma_ridge", "shrink": "learned"},
    {"crop": "Wheat", "band": "22-30", "family": "ma_ridge", "shrink": "learned"},
    {"crop": "Tomato", "band": "31-45", "family": "yoy_xgb", "shrink": "learned"},
]
# Tomato 46-60 (crop XGBoost x 0.5) clears this script's rule, but that rule's projection test trains up to the scored period. In the leak-free
# test of scripts/evaluate_stale_forecasts.py (records ending 302 days before the start, as in the app) it loses to the flat baseline in fold A
# (-18.7 %), so it is NOT deployed. The same check should be repeated for the Wheat cells above.


class _Fit:
    """Adapter: fit(X, y) -> object with predict(X) on the family's own input columns."""
    def __init__(self, family: str, X: pd.DataFrame, y) -> None:
        self.family = family
        self.cols = {"xgb": FEATURES, "ma_ridge": MA_FEATURES, "yoy_xgb": FEATURES + ["yoy_gap"]}[family]
        if family == "xgb":
            self.model = fit_xgb(X[self.cols], y)
        elif family == "yoy_xgb":
            self.model = xgb(X[self.cols], y)
        else:
            self.model = MovingAverageRidge(MA_FEATURES).fit(X, y)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.model.predict(X) if self.family == "ma_ridge" else self.model.predict(X[self.cols])


def _train(feat, mask, cell, lo, hi, before, rng):
    X, y, _, od, hs = build(feat, mask, cell["crop"], lo, hi, rng, target_before=before)
    if len(y) > MAX_TRAIN:
        k = rng.choice(len(y), MAX_TRAIN, replace=False)
        X, y, od, hs = X.iloc[k].reset_index(drop=True), y[k], od[k], hs[k]
    fam = cell["family"]
    factor = learned_factor(X, y, od, hs, lambda A, b: _Fit(fam, A, b)) if cell["shrink"] == "learned" else float(cell["shrink"])
    return _Fit(fam, X, y), len(y), factor


def evaluate(feat, mask, cell, lo, hi, rng, table=None):
    """Score one cell on folds C, A and T in both scenarios with one sampling seed. Returns (per-split results, error quantiles)."""
    crop, band = cell["crop"], cell["band"]
    res, qs = {}, None
    for name in ("C", "A", "T"):
        before, o_from, o_to = SPLITS[name]
        m, n_train, factor = _train(feat, mask, cell, lo, hi, before, rng)
        X, y, p0, _, _ = build(feat, mask, crop, lo, hi, rng, o_from=o_from, o_to=o_to)
        pred = factor * m.predict(X)
        base = float(np.mean(np.abs(p0 * np.exp(y) - p0)))
        mod = float(np.mean(np.abs(p0 * np.exp(y) - p0 * np.exp(pred))))
        level = float(np.mean(p0 * np.exp(y)))
        real = {"n": int(len(y)), "model_mae": round(mod, 1), "no_change_mae": round(base, 1), "skill_pct": round(100 * (1 - mod / base), 2),
                "baseline": "no change", "wape_pct": round(100 * mod / level, 2), "baseline_wape_pct": round(100 * base / level, 2)}
        r = y - pred
        if name == "A":   # error quantiles are calibrated on the validation fold only
            qs = {"q10": float(np.quantile(r, 0.10)), "q90": float(np.quantile(r, 0.90)), "median_abs": float(np.median(np.abs(r)))}
        if name == "T":
            real["coverage_pct"] = round(100 * float(np.mean((r >= qs["q10"]) & (r <= qs["q90"]))), 1)
        Xp, truth, start, _, _ = build(feat, mask, crop, lo, hi, rng, o_from=o_from, o_to=o_to, projection=True)
        pp = factor * m.predict(Xp)
        pb, pm = float(np.mean(np.abs(start - truth))), float(np.mean(np.abs(start * np.exp(pp) - truth)))
        lvl = float(np.mean(truth))
        proj = {"n": int(len(truth)), "model_mae": round(pm, 1), "start_price_mae": round(pb, 1), "no_change_mae": round(pb, 1),
                "skill_pct": round(100 * (1 - pm / pb), 2), "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
                "wape_pct": round(100 * pm / lvl, 2), "baseline_wape_pct": round(100 * pb / lvl, 2)}
        if name == "T":
            lo_p, hi_p = start * np.exp(pp + qs["q10"]), start * np.exp(pp + qs["q90"])
            proj["coverage_pct"] = round(100 * float(np.mean((truth >= lo_p) & (truth <= hi_p))), 1)
        res[name] = {"train_pairs": n_train, "shrink": round(factor, 4), "real_origin": real, "projection": proj}
        log(f"{crop} {band} {cell['family']} {name}: real {real['skill_pct']:+.1f}%  projection {proj['skill_pct']:+.1f}%")
        if table is not None:
            table.append({"crop": crop, "band": band, "family": cell["family"], "split": name, **res[name]})
    return res, qs


def main() -> None:
    feat, mask = load()
    feat["yoy_gap"] = feat["log_price"] - feat.groupby(SERIES_KEY, sort=False)["log_price"].shift(365)
    seed = int(os.getenv("CROP_BAND_SEED", SEED))   # CROP_BAND_SEED / CROP_BAND_DRYRUN=1: a sampling-robustness check that saves nothing
    rng = np.random.default_rng(seed)
    cells, table, rejected = {}, [], []
    for cell in CELLS:
        crop, band = cell["crop"], cell["band"]
        lo, hi = SUBBANDS[band]
        res, qs = evaluate(feat, mask, cell, lo, hi, rng, table)
        # sampling robustness: the cell must also clear the margin under two other random draws of training pairs and test cases
        weakest = [min(res[n][sc]["skill_pct"] for n in "CAT" for sc in ("real_origin", "projection"))]
        for extra in (1, 2):
            r2, _ = evaluate(feat, mask, cell, lo, hi, np.random.default_rng(seed + extra))
            weakest.append(min(r2[n][sc]["skill_pct"] for n in "CAT" for sc in ("real_origin", "projection")))
        res["_weakest_by_seed"] = [round(w, 2) for w in weakest]
        skills = weakest
        if min(skills) < MARGIN_PCT:
            rejected.append({"crop": crop, "band": band, "family": cell["family"], "weakest_score_by_seed": res["_weakest_by_seed"]})
            log(f"REJECTED {crop} {band}: weakest score by seed {res['_weakest_by_seed']} (needs >= {MARGIN_PCT}% under every seed)")
            continue
        final, n_final, final_factor = _train(feat, mask, cell, lo, hi, None, rng)
        cells[f"{crop}|{band}"] = {"crop": crop, "band": band, "h_lo": lo, "h_hi": hi, "family": cell["family"], "features": final.cols,
                                   "model": final.model, "shrink": final_factor, "shrink_rule": cell["shrink"], **qs,
                                   "final_train_pairs": n_final, "splits": {k: v for k, v in res.items() if not k.startswith("_")}, "weakest_skill_by_seed": res["_weakest_by_seed"]}
    meta = {"version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"), "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "features": FEATURES, "margin_pct": MARGIN_PCT, "projection_level": LEVEL, "data_end": "2025-12-31",
            "rule": "adopted only if skill >= +2% vs baseline in folds C, A and test T, in both the real-origin and the projection scenario, under each of three sampling seeds",
            "rejected": rejected}
    if os.getenv("CROP_BAND_DRYRUN") == "1":
        log(f"dry run (seed {seed}): {len(cells)} cell(s) would be saved, rejected {[(r['crop'], r['band']) for r in rejected]}")
        return
    joblib.dump({**meta, "cells": cells}, paths.PRICE_MODEL_DIR / "crop_band_models.joblib")
    (paths.PRICE_MODEL_DIR / "crop_band_models.json").write_text(json.dumps(
        {**meta, "cells": {k: {kk: vv for kk, vv in v.items() if kk != "model"} for k, v in cells.items()}, "table": table}, indent=1), encoding="utf-8")
    log(f"saved {len(cells)} cell model(s); rejected {len(rejected)}")


if __name__ == "__main__":
    main()
