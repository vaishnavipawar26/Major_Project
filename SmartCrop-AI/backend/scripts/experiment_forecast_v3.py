"""Third model search: finer horizon sub-bands and more model families, both scenarios, per crop.

Run from backend/:   python -m scripts.experiment_forecast_v3

Same chronological splits and adoption rule as v2 (train targets before 2024-07-01 / 2025-01-01 / 2025-07-01; score the following half-year; a
candidate is adoptable only if it beats its baseline by >= 2 % in folds C, A and T in BOTH scenarios: real origin vs no-change, projection vs the
reference price x 1.05). New here:

  sub-bands   1-7, 8-14, 15-21, 22-30, 31-45, 46-60 days (a cell can validate where the wider bands of v2 do not)
  rf_learned  Random Forest, scaled by a factor learned on the training data only (earliest 80 % fit, regress y on the prediction for the rest)
  xgb_learned XGBoost, same scaling (the v2 winner for Tomato)
  ma_ridge    ridge regression on moving-average gaps only (7/14/30-day rolling-mean gaps, 30-day change, momentum, gap to the state median),
              scaled by a learned factor: the "moving average" family
  yoy_xgb     XGBoost with one extra input, the log price now minus the log price 365 days earlier (needs a year of history), learned factor
Also reported per crop: how large the year-over-year level swings are (the reason the projection scenario cannot be learned from 3 years).
"""
from __future__ import annotations

import json
import time
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from app.ml.common import paths
from app.ml.price_prediction.band_models import MA_FEATURES, MovingAverageRidge
from app.ml.price_prediction.features import SERIES_KEY, target_log_change, with_pair_features
from scripts.experiment_forecast_v2 import learned_factor
from scripts.experiment_hard_crops import CROPS, FEATURES, LEVEL, MARGIN_PCT, SEED, SPLITS, load, log

warnings.filterwarnings("ignore")
SUBBANDS = {"1-7": (1, 7), "8-14": (8, 14), "15-21": (15, 21), "22-30": (22, 30), "31-45": (31, 45), "46-60": (46, 60)}
CANDS = ["xgb_learned", "rf_learned", "ma_ridge", "yoy_xgb"]
H_PER = 2
MAX_TRAIN = 70_000
_TLC: dict[int, np.ndarray] = {}


def tlc(feat, h):
    if h not in _TLC:
        _TLC[h] = target_log_change(feat, h).to_numpy().astype("float32")
    return _TLC[h]


def xgb(X, y):
    return XGBRegressor(n_estimators=150, learning_rate=0.05, max_depth=3, min_child_weight=200, subsample=0.7, colsample_bytree=0.7,
                        reg_lambda=20.0, tree_method="hist", n_jobs=-1, random_state=SEED).fit(X, y)


def rf(X, y):
    return RandomForestRegressor(n_estimators=80, max_depth=7, min_samples_leaf=300, max_features=0.5, n_jobs=-1, random_state=SEED).fit(X.fillna(-9), y)


class RF:
    def __init__(self, X, y):
        self.m = rf(X, y)

    def predict(self, X):
        return self.m.predict(X.fillna(-9))


class MA:
    def __init__(self, X, y):
        self.m = MovingAverageRidge(MA_FEATURES).fit(X, y)

    def predict(self, X):
        return self.m.predict(X)


def build(feat, mask, crop, lo, hi, rng, *, target_before=None, o_from=None, o_to=None, projection=False):
    """(X incl. yoy_gap, y or truth, p0/start, origin dates, horizons). Projection: reference-origin features, start = price x1.05, truth = price at +1y+h."""
    sel = mask & (feat["Commodity"] == crop).to_numpy()
    d = feat["Date"]
    if o_from is not None:
        a, b = pd.Timestamp(o_from), pd.Timestamp(o_to)
        if projection:
            a, b = a - pd.DateOffset(years=1), b - pd.DateOffset(years=1)
        sel &= ((d >= a) & (d <= b)).to_numpy()
    base = feat[sel]
    idx = np.flatnonzero(sel)
    Xs, ys, ps, ds, hs = [], [], [], [], []
    for _ in range(H_PER):
        h = rng.integers(lo, hi + 1, size=len(base))
        if projection:
            f = base[[*SERIES_KEY, "Date", "log_price"]].copy()
            f["tdate"] = f["Date"] + pd.DateOffset(years=1) + pd.to_timedelta(h, unit="D")
            f["_i"] = np.arange(len(f))
            f = f.merge(feat[[*SERIES_KEY, "Date", "target_price"]].rename(columns={"Date": "tdate"}), on=[*SERIES_KEY, "tdate"], how="left").sort_values("_i")
            ok = f["target_price"].notna().to_numpy()
            y = f["target_price"].to_numpy()
            p0 = np.exp(base["log_price"].to_numpy()) * LEVEL
        else:
            y = np.full(len(base), np.nan)
            for hv in np.unique(h):
                y[h == hv] = tlc(feat, int(hv))[idx][h == hv]
            ok = np.isfinite(y)
            if target_before is not None:
                ok &= (base["Date"].to_numpy().astype("datetime64[D]") + h.astype("timedelta64[D]")) < np.datetime64(target_before)
            p0 = np.exp(base["log_price"].to_numpy())
        X = with_pair_features(base, h)[FEATURES]
        X["yoy_gap"] = base["yoy_gap"].to_numpy().astype("float32")
        Xs.append(X[ok]); ys.append(y[ok]); ps.append(p0[ok]); ds.append(base["Date"].to_numpy()[ok]); hs.append(h[ok])
    return (pd.concat(Xs, ignore_index=True), np.concatenate(ys), np.concatenate(ps), np.concatenate(ds), np.concatenate(hs))


def swings(feat) -> dict:
    s = feat[(feat["Market"] == "All markets (state median)")].copy()
    s["ym"] = s["Date"].dt.to_period("M")
    out = {}
    for c in CROPS:
        g = s[s["Commodity"] == c].groupby("ym")["price"].median()
        r = {}
        for lab, (y0, y1) in {"2024_vs_2023": (2023, 2024), "2025_vs_2024": (2024, 2025)}.items():
            v = [g.get(pd.Period(f"{y1}-{m:02d}")) / g.get(pd.Period(f"{y0}-{m:02d}")) for m in range(7, 13)]
            r[lab] = [round(float(x), 2) for x in v]
        r["mean_abs_miss_of_x1.05"] = round(float(np.mean(np.abs(np.array(r["2024_vs_2023"] + r["2025_vs_2024"]) - 1.05))), 2)
        out[c] = r
    return out


def main() -> None:
    t0 = time.time()
    feat, mask = load()
    feat["yoy_gap"] = feat["log_price"] - feat.groupby(SERIES_KEY, sort=False)["log_price"].shift(365)
    rng = np.random.default_rng(SEED)
    rows = []
    for crop in CROPS:
        for band, (lo, hi) in SUBBANDS.items():
            for name, (before, o_from, o_to) in SPLITS.items():
                X, y, _, od, hs = build(feat, mask, crop, lo, hi, rng, target_before=before)
                if len(y) > MAX_TRAIN:
                    k = rng.choice(len(y), MAX_TRAIN, replace=False)
                    X, y, od, hs = X.iloc[k].reset_index(drop=True), y[k], od[k], hs[k]
                Xr, yr, p0, _, _ = build(feat, mask, crop, lo, hi, rng, o_from=o_from, o_to=o_to)
                Xp, truth, start, _, _ = build(feat, mask, crop, lo, hi, rng, o_from=o_from, o_to=o_to, projection=True)
                if len(yr) < 400 or len(truth) < 400:
                    continue
                base_r = float(np.mean(np.abs(p0 * np.exp(yr) - p0)))
                base_p = float(np.mean(np.abs(start - truth)))
                cols = FEATURES
                fits = {
                    "xgb_learned": (lambda A, b: xgb(A[cols], b), lambda m, A: m.predict(A[cols])),
                    "rf_learned": (lambda A, b: RF(A[cols], b), lambda m, A: m.predict(A[cols])),
                    "ma_ridge": (lambda A, b: MA(A, b), lambda m, A: m.predict(A)),
                    "yoy_xgb": (lambda A, b: xgb(A[cols + ["yoy_gap"]], b), lambda m, A: m.predict(A[cols + ["yoy_gap"]])),
                }
                line = []
                for cand, (fit_fn, pred_fn) in fits.items():
                    class W:   # adapter so learned_factor can call fit(X, y).predict(X)
                        def __init__(s, A, b): s.m = fit_fn(A, b)
                        def predict(s, A): return pred_fn(s.m, A)
                    a = learned_factor(X, y, od, hs, lambda A, b: W(A, b))
                    m = W(X, y)
                    pr, pp = a * m.predict(Xr), a * m.predict(Xp)
                    sr = 100 * (1 - float(np.mean(np.abs(p0 * np.exp(pr) - p0 * np.exp(yr)))) / base_r)
                    sp = 100 * (1 - float(np.mean(np.abs(start * np.exp(pp) - truth))) / base_p)
                    rows.append({"crop": crop, "band": band, "split": name, "candidate": cand, "real_skill_pct": round(sr, 2),
                                 "proj_skill_pct": round(sp, 2), "factor": round(a, 3), "n_real": int(len(yr)), "n_proj": int(len(truth))})
                    line.append(f"{cand} {sr:+.0f}/{sp:+.0f}")
                log(f"{crop} {band} {name}: " + "; ".join(line))
    df = pd.DataFrame(rows)
    adoptable = []
    for (crop, band, cand), g in df.groupby(["crop", "band", "candidate"]):
        s = g.set_index("split")
        if all(k in s.index for k in "CAT"):
            worst = float(min(s.loc[list("CAT"), "real_skill_pct"].min(), s.loc[list("CAT"), "proj_skill_pct"].min()))
            if worst >= MARGIN_PCT:
                adoptable.append({"crop": crop, "band": band, "candidate": cand, "worst_skill_pct": round(worst, 2), "factor_T": float(s.loc["T", "factor"])})
    out = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "margin_pct": MARGIN_PCT, "rows": rows, "adoptable": adoptable,
           "yoy_swings": swings(feat), "seconds": round(time.time() - t0)}
    (paths.REPORTS_DIR / "forecast_v3_experiment.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    md = ["# Forecast model search v3 (sub-bands, Random Forest, moving-average regression, year-over-year input)", "",
          f"Skill % = 1 - MAE / baseline MAE, real-origin / projection for folds C | A | T. Adoption needs >= {MARGIN_PCT:.0f}% in all six numbers.", "",
          "| crop | band | " + " | ".join(CANDS) + " |", "|---|---|" + "---|" * len(CANDS)]
    for (crop, band), g in df.groupby(["crop", "band"], sort=False):
        cells = []
        for cand in CANDS:
            s = g[g["candidate"] == cand].set_index("split")
            cells.append(" ".join(f"{s.loc[k, 'real_skill_pct']:+.0f}/{s.loc[k, 'proj_skill_pct']:+.0f}" if k in s.index else "n/a" for k in "CAT"))
        md.append(f"| {crop} | {band} | " + " | ".join(cells) + " |")
    md += ["", "## Adoptable", ""] + ([f"* {a['crop']} {a['band']}: {a['candidate']} (worst of six {a['worst_skill_pct']:+.1f}%)" for a in adoptable] or ["None."])
    md += ["", "## Year-over-year level swings of the state-median price, Jul-Dec (the projection baseline assumes x1.05)", "",
           "| crop | 2024 / 2023 by month | 2025 / 2024 by month | mean abs miss of x1.05 |", "|---|---|---|---|"]
    md += [f"| {c} | {v['2024_vs_2023']} | {v['2025_vs_2024']} | {v['mean_abs_miss_of_x1.05']} |" for c, v in out["yoy_swings"].items()]
    (paths.REPORTS_DIR / "forecast_v3_experiment.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    log(f"done in {out['seconds']} s; adoptable {len(adoptable)}")


if __name__ == "__main__":
    main()
