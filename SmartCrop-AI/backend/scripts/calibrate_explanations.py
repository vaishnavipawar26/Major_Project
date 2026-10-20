"""Calibrate the "small / moderate / strong" labels of the price explanations.

Run from backend/ after training:  python -m scripts.calibrate_explanations

For each farmer-facing factor group (price_explainer.FACTOR_GROUPS) this measures the
distribution of |group contribution| (log-ratio space, summed over the group's features) on a
random sample of forecasts whose origins fall in the held-out period (>= 2025-07-01) and
stores the median (p50) and 85th percentile (p85):

    |contribution| < p50          -> "small"    (weaker than this factor's typical effect)
    p50 <= |contribution| < p85   -> "moderate"
    |contribution| >= p85         -> "strong"   (among its largest effects)

so the labels reflect how unusual a contribution is for that factor, not an arbitrary cut-off.
Output: <model dir>/explanation_calibration.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.explainability.price_explainer import FACTOR_GROUPS
from app.ml.price_prediction.features import (HORIZONS, compute_features, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_prediction.forecaster import PriceForecaster
from app.ml.price_prediction.weather_features import attach

SEED = 42
N_SAMPLE = 3000
FROM_DATE = "2025-07-01"


def main() -> None:
    f = PriceForecaster()
    feat = compute_features(f.panel, f.encoders, with_targets=False)
    if f.uses_weather:
        feat = attach(feat, f.weather_feats)
    ok = usable_origin_mask(feat) & (feat["Date"] >= pd.Timestamp(FROM_DATE))
    base = feat[ok].reset_index(drop=True)
    rng = np.random.default_rng(SEED)
    pick = rng.choice(len(base), size=min(N_SAMPLE, len(base)), replace=False)
    hs = rng.choice(np.asarray(HORIZONS), size=len(pick))
    X = with_pair_features(base.iloc[pick], hs)[f.feature_columns]
    sv = np.zeros(X.shape)
    for c, m in f.models.items():
        rows = np.array([f.horizon_models[int(h)] == c for h in hs])
        if rows.any():
            v = np.asarray(f.explainers[c].shap_values(X[rows]))
            sv[rows] = v * hs[rows][:, None] if f.rate_form[c] else v
    cols = list(f.feature_columns)
    groups = {}
    for g, feats in FACTOR_GROUPS.items():
        idx = [cols.index(x) for x in feats if x in cols]
        if not idx:
            continue
        a = np.abs(sv[:, idx].sum(axis=1))
        groups[g] = {"p50": float(np.quantile(a, 0.50)), "p85": float(np.quantile(a, 0.85)),
                     "n": int(len(a))}
    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "model_version": f.version, "space": "log(price ratio)",
           "sample": f"{len(pick)} random (origin, horizon) forecasts, origins >= {FROM_DATE}, horizons 1-60",
           "rule": "small < p50 <= moderate < p85 <= strong; below 0.004 always small",
           "groups": groups}
    (paths.PRICE_MODEL_DIR / "explanation_calibration.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    for g, t in groups.items():
        print(f"{g:13s} p50={t['p50']:.4f} p85={t['p85']:.4f}")


if __name__ == "__main__":
    main()
