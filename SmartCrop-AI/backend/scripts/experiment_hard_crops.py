"""Experiment: can crop-specific, horizon-band-specific models validate for Onion, Potato, Tomato and Wheat?

Run from backend/:   python -m scripts.experiment_hard_crops

Nothing here changes a deployed artifact. It writes dataset/reports/hard_crops_experiment.json and .md.

Part 1 reproduces why the four crops fail today (stored cross-validation numbers and the policy reasons).
Part 2 trains new candidates on strictly earlier data and scores them on later, unseen origins:

  fold C  train pairs whose TARGET date is before 2024-07-01, validate origins 2024-07-01 .. 2024-12-31
  fold A  train pairs whose TARGET date is before 2025-01-01, validate origins 2025-01-01 .. 2025-06-30
  test T  train pairs whose TARGET date is before 2025-07-01, test origins 2025-07-01 .. 2025-12-31 (never used to choose anything)

Candidates (per crop, per horizon band 1-7 / 8-14 / 15-30 / 31-60 days; one model per crop and band):
  no_change      price stays the same (the baseline; the 2 % margin is measured against it)
  xgb_l2         crop-specific XGBoost, squared error, strong regularisation
  xgb_huber      the same with a pseudo-Huber loss (less pulled by the few price spikes)
  xgb_l2_half    xgb_l2 with its predicted change halved (shrinkage toward no change)
  seasonal_med   median log change over the same calendar window in the earlier years of that crop (no model)

Adoption rule, fixed before the run and the same margin as scripts/build_crop_policy.py: a candidate is ADOPTABLE for a crop and band
only if its MAE beats no-change by at least +2 % in fold C AND fold A AND test T. Even then the production policy additionally needs the
projection backtest (scripts.phaseB_projection) before crop_policy.json may change; this script never edits the policy.
"""
from __future__ import annotations

import json
import time
import warnings
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from app.ml.common import paths
from app.ml.price_prediction.features import (MODEL_FEATURES, SERIES_KEY, compute_features, target_log_change,
                                              usable_origin_mask, with_pair_features)

warnings.filterwarnings("ignore")
CROPS = ["Onion", "Potato", "Tomato", "Wheat"]
BANDS = {"1-7": (1, 7), "8-14": (8, 14), "15-30": (15, 30), "31-60": (31, 60)}
MARGIN_PCT = 2.0
SEED = 42
SPLITS = {  # name: (train targets before, origin start, origin end inclusive)
    "C": ("2024-07-01", "2024-07-01", "2024-12-31"),
    "A": ("2025-01-01", "2025-01-01", "2025-06-30"),
    "T": ("2025-07-01", "2025-07-01", "2025-12-31"),
}
H_PER_ORIGIN = 3            # random horizons per origin and band
MAX_TRAIN_PAIRS = 150_000
FEATURES = [c for c in MODEL_FEATURES if c != "commodity_code"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def part1_current_failures() -> dict:
    """The stored CV result (all 4 folds of 2025, unsmoothed MAE) and the policy's reasons, per crop and band."""
    pc = pd.read_csv(paths.PRICE_MODEL_DIR / "cv_per_crop_metrics.csv")
    pol = json.loads((paths.MODELS_DIR / "price_reliability" / "crop_policy.json").read_text(encoding="utf-8"))
    out = {}
    for crop in CROPS:
        out[crop] = {}
        for band, (lo, hi) in BANDS.items():
            g = pc[(pc["commodity"] == crop) & pc["horizon"].between(lo, hi)]
            skill = 100 * (1 - g["model_MAE_unsmoothed"].sum() / g["naive_MAE_unsmoothed"].sum()) if len(g) else None
            out[crop][band] = {"cv_skill_vs_no_change_pct": None if skill is None else round(float(skill), 2),
                               "cv_model_mae": round(float(g["model_MAE_unsmoothed"].mean()), 1),
                               "cv_naive_mae": round(float(g["naive_MAE_unsmoothed"].mean()), 1),
                               "policy_mode": pol["cells"][f"{crop}|{band}"]["mode"],
                               "policy_reasons": pol["cells"][f"{crop}|{band}"]["reasons"]}
    return out


def load():
    prep = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")
    enc = prep["encoders"]
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    panel = panel[panel["Commodity"].isin(CROPS)]
    for c in SERIES_KEY:
        panel[c] = panel[c].astype(str)
    feat = compute_features(panel, enc, with_targets=True)
    mask = usable_origin_mask(feat).to_numpy()
    return feat, mask


_TLC: dict[int, np.ndarray] = {}


def tlc(feat, h: int) -> np.ndarray:
    """log(price[t+h] / price[t]) for every row, computed once per horizon."""
    if h not in _TLC:
        _TLC[h] = target_log_change(feat, h).to_numpy().astype("float32")
    return _TLC[h]


def pairs(feat, mask, crop, lo, hi, rng, origin_from=None, origin_to=None, target_before=None):
    """(X, y, p0, origin date) pairs for one crop and horizon band, honouring the split's date limits."""
    sel = mask & (feat["Commodity"] == crop).to_numpy()
    d = feat["Date"]
    if origin_from is not None:
        sel &= ((d >= origin_from) & (d <= origin_to)).to_numpy()
    base = feat[sel]
    idx = np.flatnonzero(sel)
    parts = []
    for _ in range(H_PER_ORIGIN):
        h = rng.integers(lo, hi + 1, size=len(base))
        # the target change is read per sampled h by looking up the shifted target price of the same series
        parts.append(h)
    Xs, ys, p0s, ds, hs = [], [], [], [], []
    for h in parts:
        y = np.full(len(base), np.nan)
        for hv in np.unique(h):
            col = tlc(feat, int(hv))[idx]
            y[h == hv] = col[h == hv]
        ok = np.isfinite(y)
        if target_before is not None:
            tgt = base["Date"].to_numpy().astype("datetime64[D]") + h.astype("timedelta64[D]")
            ok &= tgt < np.datetime64(target_before)
        X = with_pair_features(base, h)[FEATURES]
        Xs.append(X[ok]); ys.append(y[ok]); hs.append(h[ok])
        p0s.append(np.exp(base["log_price"].to_numpy())[ok]); ds.append(base["Date"].to_numpy()[ok])
    return (pd.concat(Xs, ignore_index=True), np.concatenate(ys), np.concatenate(p0s), np.concatenate(ds), np.concatenate(hs))


def fit_xgb(X, y, huber=False):
    m = XGBRegressor(n_estimators=250, learning_rate=0.04, max_depth=3, min_child_weight=200, subsample=0.7, colsample_bytree=0.7,
                     reg_lambda=20.0, objective="reg:pseudohubererror" if huber else "reg:squarederror",
                     tree_method="hist", n_jobs=-1, random_state=SEED)
    m.fit(X, y)
    return m


def seasonal_median(feat, crop, origin_dates, hs, test_start):
    """Median log change over the same calendar window in earlier years, from the crop's state-median series, using only
    windows that END before ``test_start`` (so no test-period price is read)."""
    s = feat[(feat["Commodity"] == crop) & (feat["Market"] == "All markets (state median)")].set_index("Date")["price"].ffill(limit=7)
    ls = np.log(s)
    od = pd.DatetimeIndex(pd.to_datetime(origin_dates))
    full = ls.reindex(pd.date_range(ls.index.min(), ls.index.max(), freq="D"))
    stack = []
    for yrs in (1, 2, 3):
        a = od - pd.DateOffset(years=yrs)
        b = a + pd.to_timedelta(hs, unit="D")
        va, vb = full.reindex(a).to_numpy(), full.reindex(b).to_numpy()
        ok = np.isfinite(va) & np.isfinite(vb) & (b < pd.Timestamp(test_start))
        stack.append(np.where(ok, vb - va, np.nan))
    st = np.vstack(stack)
    with np.errstate(all="ignore"):
        med = np.nanmedian(st, axis=0)
    return np.where(np.isfinite(med), med, 0.0)


def mae(p0, y, pred):
    return float(np.mean(np.abs(p0 * np.exp(pred) - p0 * np.exp(y))))


LEVEL = 1.05          # the production projection anchor: the reference-year price moved forward one year at 5 %
PROJECTION_CELLS = {  # the cells that cleared the real-origin rule above; each is re-scored under the projection scenario
    "Potato": ["1-7", "8-14", "15-30"], "Wheat": ["1-7", "8-14", "15-30"], "Tomato": ["31-60"]}


def projection_pairs(feat, mask, crop, lo, hi, rng, o_from, o_to):
    """Projection scenario (how the app serves every request while records end in 2025): the forecast start is a day ``o`` in
    [o_from, o_to]; the data used is the SAME day one year earlier (the reference origin); the start price is that day's price x1.05; the truth
    is the price actually reported at o + h in the same series. Returns X (reference-origin features), start price, truth, horizons."""
    lo_d, hi_d = pd.Timestamp(o_from) - pd.DateOffset(years=1), pd.Timestamp(o_to) - pd.DateOffset(years=1)
    sel = mask & (feat["Commodity"] == crop).to_numpy() & ((feat["Date"] >= lo_d) & (feat["Date"] <= hi_d)).to_numpy()
    ref = feat[sel]
    frames = []
    for _ in range(H_PER_ORIGIN):
        h = rng.integers(lo, hi + 1, size=len(ref))
        f = ref[[*SERIES_KEY, "Date", "log_price"]].copy()
        f["h"] = h
        f["tdate"] = f["Date"] + pd.DateOffset(years=1) + pd.to_timedelta(h, unit="D")
        f["_i"] = np.arange(len(f))
        X = with_pair_features(ref, h)[FEATURES]
        f = f.merge(feat[[*SERIES_KEY, "Date", "target_price"]].rename(columns={"Date": "tdate"}), on=[*SERIES_KEY, "tdate"], how="left").sort_values("_i")
        ok = f["target_price"].notna().to_numpy()
        frames.append((X[ok].reset_index(drop=True), np.exp(f["log_price"].to_numpy()[ok]) * LEVEL, f["target_price"].to_numpy()[ok], h[ok]))
    return (pd.concat([x for x, *_ in frames], ignore_index=True), np.concatenate([a for _, a, *_ in frames]),
            np.concatenate([b for _, _, b, _ in frames]), np.concatenate([c for *_, c in frames]))


def part3_projection(rng) -> list[dict]:
    feat, mask = load()
    rows = []
    for crop, bands in PROJECTION_CELLS.items():
        for band in bands:
            lo, hi = BANDS[band]
            for name, (before, o_from, o_to) in SPLITS.items():
                Xtr, ytr, _, _, _ = pairs(feat, mask, crop, lo, hi, rng, target_before=before)
                if len(ytr) > MAX_TRAIN_PAIRS:
                    keep = rng.choice(len(ytr), MAX_TRAIN_PAIRS, replace=False)
                    Xtr, ytr = Xtr.iloc[keep], ytr[keep]
                m = fit_xgb(Xtr, ytr)
                Xte, start, truth, _ = projection_pairs(feat, mask, crop, lo, hi, rng, o_from, o_to)
                if len(truth) < 500:
                    continue
                base = float(np.mean(np.abs(start - truth)))
                mod = float(np.mean(np.abs(start * np.exp(0.5 * m.predict(Xte)) - truth)))
                full = float(np.mean(np.abs(start * np.exp(m.predict(Xte)) - truth)))
                rows.append({"crop": crop, "band": band, "split": name, "n": int(len(truth)), "start_price_mae": round(base, 1),
                             "xgb_l2_half_mae": round(mod, 1), "skill_half_pct": round(100 * (1 - mod / base), 2),
                             "skill_full_pct": round(100 * (1 - full / base), 2)})
                log(f"projection {crop} {band} {name}: n={len(truth):,} start-price MAE {base:.0f}; half {100 * (1 - mod / base):+.1f}%; full {100 * (1 - full / base):+.1f}%")
    return rows


def main() -> None:
    import sys
    if "--projection" in sys.argv:
        rows = part3_projection(np.random.default_rng(SEED))
        (paths.REPORTS_DIR / "hard_crops_projection.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
        return
    t0 = time.time()
    report = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "margin_pct": MARGIN_PCT, "splits": SPLITS,
              "candidates": ["no_change", "xgb_l2", "xgb_huber", "xgb_l2_half", "seasonal_med"]}
    report["part1_current"] = part1_current_failures()
    log("part 1 done; building features")
    feat, mask = load()
    log(f"features ready, {int(mask.sum()):,} usable origins in the four crops")
    rng = np.random.default_rng(SEED)
    rows = []
    for crop in CROPS:
        for band, (lo, hi) in BANDS.items():
            for name, (before, o_from, o_to) in SPLITS.items():
                Xtr, ytr, _, _, _ = pairs(feat, mask, crop, lo, hi, rng, target_before=before, origin_to=None)
                if len(ytr) > MAX_TRAIN_PAIRS:
                    keep = rng.choice(len(ytr), MAX_TRAIN_PAIRS, replace=False)
                    Xtr, ytr = Xtr.iloc[keep], ytr[keep]
                Xte, yte, p0, od, hte = pairs(feat, mask, crop, lo, hi, rng, origin_from=o_from, origin_to=o_to)
                if len(yte) < 500:
                    continue
                base = mae(p0, yte, np.zeros(len(yte)))
                preds = {"no_change": np.zeros(len(yte))}
                m = fit_xgb(Xtr, ytr)
                preds["xgb_l2"] = m.predict(Xte)
                preds["xgb_l2_half"] = 0.5 * preds["xgb_l2"]
                preds["xgb_huber"] = fit_xgb(Xtr, ytr, huber=True).predict(Xte)
                preds["seasonal_med"] = seasonal_median(feat, crop, od, hte, o_from)
                for cand, pr in preds.items():
                    mm = mae(p0, yte, pr)
                    rows.append({"crop": crop, "band": band, "split": name, "candidate": cand, "n": int(len(yte)),
                                 "mae": round(mm, 1), "no_change_mae": round(base, 1),
                                 "skill_pct": round(100 * (1 - mm / base), 2)})
                log(f"{crop} {band} {name}: n={len(yte):,} no-change MAE {base:.0f}; "
                    + "; ".join(f"{c} {100 * (1 - mae(p0, yte, p) / base):+.1f}%" for c, p in preds.items() if c != "no_change"))
    df = pd.DataFrame(rows)
    report["rows"] = rows
    adoptable = []
    for (crop, band, cand), g in df[df["candidate"] != "no_change"].groupby(["crop", "band", "candidate"]):
        s = g.set_index("split")["skill_pct"]
        if all(k in s.index for k in "CAT") and (s[list("CAT")] >= MARGIN_PCT).all():
            adoptable.append({"crop": crop, "band": band, "candidate": cand, **{f"skill_{k}": float(s[k]) for k in "CAT"}})
    report["adoptable"] = adoptable
    report["seconds"] = round(time.time() - t0)
    out = paths.REPORTS_DIR
    (out / "hard_crops_experiment.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    md = ["# Onion, Potato, Tomato, Wheat: can a crop- and band-specific model validate?", "",
          f"Generated {report['created']} by `scripts/experiment_hard_crops.py`. Skill = 1 - MAE/no-change MAE (price scale); the adoption margin is +{MARGIN_PCT:.0f}% in folds C and A and on the untouched test T.", "",
          "## 1. Why each crop fails today (stored cross-validation, 2025, and the policy's reasons)", "",
          "| crop | band | CV skill vs no-change | policy | reasons |", "|---|---|---|---|---|"]
    for crop, bands in report["part1_current"].items():
        for band, v in bands.items():
            md.append(f"| {crop} | {band} | {v['cv_skill_vs_no_change_pct']:+.1f}% | {v['policy_mode']} | {'; '.join(v['policy_reasons'])[:230]} |")
    md += ["", "## 2. New candidates (skill vs no-change, %, fold C / fold A / test T)", "", "| crop | band | n (T) | " + " | ".join(c for c in report["candidates"] if c != "no_change") + " |", "|---|---|---|---|---|---|---|"]
    for (crop, band), g in df.groupby(["crop", "band"]):
        cells = []
        for cand in report["candidates"]:
            if cand == "no_change":
                continue
            s = g[g["candidate"] == cand].set_index("split")["skill_pct"]
            cells.append(" / ".join(f"{s.get(k, float('nan')):+.1f}" for k in "CAT"))
        n = int(g[(g["split"] == "T")]["n"].iloc[0]) if (g["split"] == "T").any() else 0
        md.append(f"| {crop} | {band} | {n:,} | " + " | ".join(cells) + " |")
    md += ["", "## 3. Adoptable (>= +2% in C, A and T)", ""]
    md += [f"* {a['crop']} {a['band']}: {a['candidate']} (C {a['skill_C']:+.1f}%, A {a['skill_A']:+.1f}%, T {a['skill_T']:+.1f}%)" for a in adoptable] or ["None."]
    (paths.REPORTS_DIR / "hard_crops_experiment.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    log(f"done in {report['seconds']} s; adoptable: {len(adoptable)}")


if __name__ == "__main__":
    main()
