"""Second model search for Onion, Potato, Tomato and Wheat over the whole 60-day range, both scenarios scored together.

Run from backend/:   python -m scripts.experiment_forecast_v2

Same chronological splits and the same fixed adoption rule as scripts/experiment_hard_crops.py (train targets before 2024-07-01 / 2025-01-01 /
2025-07-01, score the following half-year; adopt a candidate for a crop and band only if it beats its baseline by >= 2 % in folds C, A and T in
BOTH scenarios: real origin vs no-change, projection vs the reference price x 1.05). Nothing is read from a later split than the one being scored.

Candidates (all predict the log price change for a direction-free, crop-specific, band-specific model):
  half        XGBoost, predicted change x 0.5 (the form deployed for Wheat 1-14)
  quarter     the same x 0.25
  learned     the same model, scaled by a factor LEARNED on the training data only: the model is fitted on the earliest 80 % of the training
              targets, the factor = clip(cov(y, pred) / var(pred), 0, 1) on the remaining training pairs, then the model is refitted on all
              training pairs and scaled by that factor (no validation or test pair is used)
  state_half  XGBoost trained only on the state-median series (the least noisy), x 0.5, applied to every series of the crop
  ridge_learned  ridge regression on standardised features, scaled by a learned factor the same way
  seasonal_local  no model: the median log change over the same calendar window in earlier years (informational lower bound)
"""
from __future__ import annotations

import json
import time
import warnings
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

from app.ml.common import paths
from app.ml.price_prediction.features import STATE_MARKET
from scripts.experiment_hard_crops import (BANDS, CROPS, FEATURES, MARGIN_PCT, SEED, SPLITS, fit_xgb, load, log, mae, pairs, projection_pairs)

warnings.filterwarnings("ignore")
CANDIDATES = ["half", "quarter", "learned", "state_half", "ridge_learned"]
MAX_TRAIN = 120_000


def learned_factor(X, y, od, hs, fit_fn):
    """Scale factor learned from training data only: fit on the earliest 80 % of target dates, regress y on the prediction for the rest."""
    tgt = od.astype("datetime64[D]") + hs.astype("timedelta64[D]")
    cut = np.quantile(tgt.astype("int64"), 0.8)
    a, b = tgt.astype("int64") < cut, od.astype("datetime64[D]").astype("int64") >= cut
    if a.sum() < 2000 or b.sum() < 500:
        return 0.5
    m = fit_fn(X[a], y[a])
    p = m.predict(X[b])
    v = np.var(p)
    return float(np.clip(np.cov(y[b], p)[0, 1] / v, 0.0, 1.0)) if v > 0 else 0.0


class Ridged:
    def __init__(self, X, y):
        self.sc = StandardScaler().fit(X.fillna(0))
        self.m = Ridge(alpha=500.0).fit(self.sc.transform(X.fillna(0)), y)

    def predict(self, X):
        return self.m.predict(self.sc.transform(X.fillna(0)))


def main() -> None:
    t0 = time.time()
    feat, mask = load()
    state_code = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")["encoders"]["market"][STATE_MARKET]
    rng = np.random.default_rng(SEED)
    rows = []
    for crop in CROPS:
        for band, (lo, hi) in BANDS.items():
            for name, (before, o_from, o_to) in SPLITS.items():
                X, y, _, od, hs = pairs(feat, mask, crop, lo, hi, rng, target_before=before)
                if len(y) > MAX_TRAIN:
                    k = rng.choice(len(y), MAX_TRAIN, replace=False)
                    X, y, od, hs = X.iloc[k].reset_index(drop=True), y[k], od[k], hs[k]
                Xr, yr, p0, _, _ = pairs(feat, mask, crop, lo, hi, rng, origin_from=o_from, origin_to=o_to)
                Xp, start, truth, _ = projection_pairs(feat, mask, crop, lo, hi, rng, o_from, o_to)
                if len(yr) < 500 or len(truth) < 500:
                    continue
                m = fit_xgb(X, y)
                pr_r, pr_p = m.predict(Xr), m.predict(Xp)
                preds = {"half": (0.5 * pr_r, 0.5 * pr_p), "quarter": (0.25 * pr_r, 0.25 * pr_p)}
                a = learned_factor(X, y, od, hs, fit_xgb)
                preds["learned"] = (a * pr_r, a * pr_p)
                is_state = (X["market_code"] == state_code).to_numpy()
                if is_state.sum() > 3000:
                    ms = fit_xgb(X[is_state], y[is_state])
                    preds["state_half"] = (0.5 * ms.predict(Xr), 0.5 * ms.predict(Xp))
                rd = Ridged(X, y)
                ar = learned_factor(X, y, od, hs, Ridged)
                preds["ridge_learned"] = (ar * rd.predict(Xr), ar * rd.predict(Xp))
                base_r, base_p = mae(p0, yr, np.zeros(len(yr))), float(np.mean(np.abs(start - truth)))
                for cand, (pr, pp) in preds.items():
                    sr = 100 * (1 - mae(p0, yr, pr) / base_r)
                    sp = 100 * (1 - float(np.mean(np.abs(start * np.exp(pp) - truth))) / base_p)
                    rows.append({"crop": crop, "band": band, "split": name, "candidate": cand, "real_skill_pct": round(sr, 2),
                                 "proj_skill_pct": round(sp, 2), "factor": round(a if cand == "learned" else ar if cand == "ridge_learned" else 0.5 if "half" in cand else 0.25, 3),
                                 "n_real": int(len(yr)), "n_proj": int(len(truth))})
                log(f"{crop} {band} {name}: " + "; ".join(f"{r['candidate']} {r['real_skill_pct']:+.1f}/{r['proj_skill_pct']:+.1f}" for r in rows[-len(preds):]))
    df = pd.DataFrame(rows)
    adoptable = []
    for (crop, band, cand), g in df.groupby(["crop", "band", "candidate"]):
        s = g.set_index("split")
        if all(k in s.index for k in "CAT"):
            worst = float(min(s.loc[list("CAT"), "real_skill_pct"].min(), s.loc[list("CAT"), "proj_skill_pct"].min()))
            if worst >= MARGIN_PCT:
                adoptable.append({"crop": crop, "band": band, "candidate": cand, "worst_skill_pct": round(worst, 2),
                                  "factor_T": float(s.loc["T", "factor"])})
    out = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "margin_pct": MARGIN_PCT, "splits": SPLITS, "rows": rows,
           "adoptable": adoptable, "seconds": round(time.time() - t0)}
    (paths.REPORTS_DIR / "forecast_v2_experiment.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = ["# Forecast model search v2 (Onion, Potato, Tomato, Wheat; all four horizon bands)", "",
          f"Skill % = 1 - MAE / baseline MAE, shown as real-origin / projection for folds C | A | T. Adoption needs >= {MARGIN_PCT:.0f}% in all six numbers.", "",
          "| crop | band | " + " | ".join(CANDIDATES) + " |", "|---|---|" + "---|" * len(CANDIDATES)]
    for (crop, band), g in df.groupby(["crop", "band"]):
        cells = []
        for cand in CANDIDATES:
            s = g[g["candidate"] == cand].set_index("split")
            cells.append(" ".join(f"{s.loc[k, 'real_skill_pct']:+.0f}/{s.loc[k, 'proj_skill_pct']:+.0f}" if k in s.index else "n/a" for k in "CAT"))
        md.append(f"| {crop} | {band} | " + " | ".join(cells) + " |")
    md += ["", "## Adoptable", ""] + ([f"* {a['crop']} {a['band']}: {a['candidate']} (worst of the six scores {a['worst_skill_pct']:+.1f}%)" for a in adoptable] or ["None."])
    (paths.REPORTS_DIR / "forecast_v2_experiment.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    log(f"done in {out['seconds']} s; adoptable {len(adoptable)}")


if __name__ == "__main__":
    main()
