"""Leak-free walk-forward evaluation of the situation the app is really in: the records end GAP days before the forecast start.

Run from backend/:   python -m scripts.evaluate_stale_forecasts

For every forecast start S in a scored half-year (folds C / A / T of experiment_hard_crops.SPLITS), the newest record is D = S - GAP (GAP =
302 days: 31 Dec 2025 to 29 Oct 2026). Every model is trained only on pairs whose TARGET date is before the earliest D of the fold, so nothing
after the records' end is ever seen (the older projection backtests trained up to S itself, about ten months more than the app ever has).
Inputs come from the same calendar day one year before S (r = S - 1 year, which is before D), as the app does. Truth = price reported at S + h.

Candidates, as a price for S + h (h = 1..60):
  pooled_prod          the app's current stitched method (rf_plain / rf_rate / xgb_rate per horizon, all crops), start p(r) x 1.05
  crop_xgb             one crop-specific XGBoost over all 60 horizons (no switching), start p(r) x 1.05
  crop_xgb_half        the same with its predicted change halved
  crop_rf              one crop-specific Random Forest over all 60 horizons
  crop_xgb_rate        one crop-specific XGBoost in the production's daily-rate form: it learns change / h (weighted by h^2) and the
                       forecast is h x that rate, so the change starts near 0 on day 1 instead of jumping (also _half, and crop_rf_rate)
  band_46_60_half      (Tomato only, h >= 46) the deployed Tomato 46-60 recipe: XGBoost on 46-60 day pairs, change x 0.5
  flat_last_year       p(r) x 1.05 for every day (the baseline of the app's +2 % rule)
  flat_latest          the newest real report p(D) for every day
  seasonal_last_year   last year's real price on the same day, p(r + h) x 1.05 (seasonal naive)
  latest_x_season      p(D) x p(r + h) / p(r): the newest real level with last year's change over the same dates
Starting price (h = 0): p(r) x 1.05, p(r), p(D) against the price reported on S.

Metrics: MAE and WAPE (sum |err| / sum actual) in Rs/quintal, per band 1-14 / 15-30 / 31-60 and fold, and over all 60 days. One sampling seed.
Decision rule for replacing the app's current estimate on days that are not validated: a candidate must have a mean 60-day MAE at least
MARGIN_PCT (the project's +2 %) lower than the current method AND be lower in at least two of the three folds. Writes
dataset/reports/stale_forecast_eval.json / .md and trained_models/price_reliability/stale_test_summary.json (the current method's and the flat
baseline's 60-day error per crop, shown beside the experimental estimates).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from app.ml.common import paths
from app.ml.price_prediction.features import MODEL_FEATURES, SERIES_KEY, with_pair_features
from scripts.evaluate_horizon_metrics import CROP_FEATURES, Data, Pooled, fit_rf
from scripts.experiment_hard_crops import LEVEL, SPLITS, fit_xgb

CROPS = ["Onion", "Potato", "Tomato"]
BANDS = {"1-14": (1, 14), "15-30": (15, 30), "31-60": (31, 60)}
GAP = 302
SEED = 42
REPS = 3
MAX_TRAIN = 150_000
MARGIN_PCT = 2.0
MODEL_CANDS = ["pooled_prod", "crop_xgb", "crop_xgb_half", "crop_rf", "crop_xgb_rate", "crop_xgb_rate_half", "crop_rf_rate"]
BASE_CANDS = ["flat_last_year", "flat_latest", "seasonal_last_year", "latest_x_season"]
OUT = "stale_forecast_eval"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def cases(data: Data, rng, crop: str, o_from: str, o_to: str) -> dict:
    """Test cases for starts S in [o_from, o_to]: inputs at r = S - 1 year; p(r), p(D), p(r + h), p(S), truth p(S + h)."""
    f = data.feat
    lo, hi = pd.Timestamp(o_from) - pd.DateOffset(years=1), pd.Timestamp(o_to) - pd.DateOffset(years=1)
    sel = data.mask & (f["Commodity"] == crop).to_numpy() & ((f["Date"] >= lo) & (f["Date"] <= hi)).to_numpy()
    ref = f[sel]
    look = f[[*SERIES_KEY, "Date", "target_price", "price_ffill"]]
    parts = []
    for _ in range(REPS):
        h = rng.integers(1, 61, size=len(ref))
        k = ref[[*SERIES_KEY, "Date", "log_price"]].copy()
        k["_i"] = np.arange(len(k))
        k["S"] = k["Date"] + pd.DateOffset(years=1)
        k["T"] = k["S"] + pd.to_timedelta(h, unit="D")
        k["D"] = k["S"] - pd.Timedelta(days=GAP)
        k["RH"] = k["Date"] + pd.to_timedelta(h, unit="D")
        for col, src, name in (("T", "target_price", "truth"), ("S", "target_price", "actual_start"), ("D", "price_ffill", "latest"),
                               ("RH", "target_price", "ly_h")):
            k = k.merge(look[[*SERIES_KEY, "Date", src]].rename(columns={"Date": col, src: name}), on=[*SERIES_KEY, col], how="left")
        k = k.sort_values("_i")
        ok = (k["truth"].notna() & k["latest"].notna() & k["ly_h"].notna()).to_numpy()
        X = with_pair_features(ref, h)[MODEL_FEATURES]
        parts.append({"X": X[ok].reset_index(drop=True), "h": h[ok], "p_r": np.exp(k["log_price"].to_numpy()[ok]),
                      "latest": k["latest"].to_numpy()[ok], "ly_h": k["ly_h"].to_numpy()[ok], "truth": k["truth"].to_numpy()[ok],
                      "actual_start": k["actual_start"].to_numpy()[ok]})
    return {key: (pd.concat([p[key] for p in parts], ignore_index=True) if key == "X" else np.concatenate([p[key] for p in parts]))
            for key in parts[0]}


def fit_rate(fit, X: pd.DataFrame, y: np.ndarray):
    """Daily-rate form (as the production rate models): target = log change / h, weight h^2; predict with predict_rate."""
    h = X["horizon_days"].to_numpy(dtype="float64")
    return fit(X[CROP_FEATURES], y / h, sample_weight=h ** 2)


def predict_rate(m, X: pd.DataFrame) -> np.ndarray:
    return m.predict(X[CROP_FEATURES]) * X["horizon_days"].to_numpy(dtype="float64")


def score(pred: np.ndarray, truth: np.ndarray) -> dict:
    err = np.abs(pred - truth)
    return {"n": int(len(truth)), "mae": round(float(err.mean()), 1), "wape_pct": round(100 * float(err.sum() / truth.sum()), 2)}


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    data = Data()
    log(f"features ready: {int(data.mask.sum()):,} usable origins")
    rows, start_rows = [], []
    for split, (_, o_from, o_to) in SPLITS.items():
        cutoff = (pd.Timestamp(o_from) - pd.Timedelta(days=GAP)).date().isoformat()     # the earliest end-of-records in this fold
        pooled = Pooled(data, rng, cutoff)
        log(f"split {split}: training targets before {cutoff}; pooled models fitted")
        for crop in CROPS:
            Xtr, ytr, *_ = data.pairs(rng, [crop], 1, 60, target_before=cutoff)
            if len(ytr) > MAX_TRAIN:
                keep = rng.choice(len(ytr), MAX_TRAIN, replace=False)
                Xtr, ytr = Xtr.iloc[keep], ytr[keep]
            xgb, rf = fit_xgb(Xtr[CROP_FEATURES], ytr), fit_rf(Xtr[CROP_FEATURES], ytr)
            xgb_r, rf_r = fit_rate(fit_xgb, Xtr, ytr), fit_rate(fit_rf, Xtr, ytr)
            band_model = None
            if crop == "Tomato":
                Xb, yb, *_ = data.pairs(rng, [crop], 46, 60, target_before=cutoff)
                band_model = fit_xgb(Xb[CROP_FEATURES], yb) if len(yb) > 500 else None
            c = cases(data, rng, crop, o_from, o_to)
            start = c["p_r"] * LEVEL
            px = xgb.predict(c["X"][CROP_FEATURES])
            prices = {"pooled_prod": start * np.exp(pooled.predict(c["X"])), "crop_xgb": start * np.exp(px),
                      "crop_xgb_half": start * np.exp(0.5 * px), "crop_rf": start * np.exp(rf.predict(c["X"][CROP_FEATURES])),
                      "crop_xgb_rate": start * np.exp(predict_rate(xgb_r, c["X"])),
                      "crop_xgb_rate_half": start * np.exp(0.5 * predict_rate(xgb_r, c["X"])),
                      "crop_rf_rate": start * np.exp(predict_rate(rf_r, c["X"])),
                      "flat_last_year": start, "flat_latest": c["latest"], "seasonal_last_year": c["ly_h"] * LEVEL,
                      "latest_x_season": c["latest"] * c["ly_h"] / c["p_r"]}
            if band_model is not None:
                prices["band_46_60_half"] = start * np.exp(0.5 * band_model.predict(c["X"][CROP_FEATURES]))
            for band, (lo, hi) in BANDS.items():
                m = (c["h"] >= lo) & (c["h"] <= hi)
                for cand, p in prices.items():
                    rows.append({"crop": crop, "split": split, "band": band, "candidate": cand, **score(p[m], c["truth"][m])})
            if band_model is not None:
                m = c["h"] >= 46
                for cand in ("band_46_60_half", "flat_last_year", "pooled_prod", "crop_xgb_half"):
                    rows.append({"crop": crop, "split": split, "band": "46-60", "candidate": cand, **score(prices[cand][m], c["truth"][m])})
            ok = np.isfinite(c["actual_start"])
            for name, p in (("last_year_x1.05", start), ("last_year", c["p_r"]), ("latest_report", c["latest"])):
                start_rows.append({"crop": crop, "split": split, "start": name, **score(p[ok], c["actual_start"][ok])})
            log(f"{split} {crop}: {len(c['truth']):,} cases")
    df = pd.DataFrame(rows)
    whole = {crop: sixty_day(df, crop) for crop in CROPS}
    decision = {crop: decide(w) for crop, w in whole.items()}
    report = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "gap_days": GAP, "splits": SPLITS, "margin_pct": MARGIN_PCT,
              "rows": rows, "start_price": start_rows, "sixty_day": {c: w.round(2).to_dict(orient="index") for c, w in whole.items()},
              "decision": decision, "seconds": round(time.time() - t0)}
    (paths.REPORTS_DIR / f"{OUT}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (paths.REPORTS_DIR / f"{OUT}.md").write_text(render(report, df), encoding="utf-8")
    summary = {"created": report["created"], "source": f"dataset/reports/{OUT}.md (scripts/evaluate_stale_forecasts.py)", "gap_days": GAP,
               "crops": {c: {"current_wape_pct": round(float(w.loc["pooled_prod", "wape_pct"]), 1),
                             "flat_wape_pct": round(float(w.loc["flat_last_year", "wape_pct"]), 1),
                             "current_mae": round(float(w.loc["pooled_prod", "mae"]), 1), "flat_mae": round(float(w.loc["flat_last_year", "mae"]), 1),
                             "n": int(w.loc["pooled_prod", "n"])} for c, w in whole.items()}}
    (paths.MODELS_DIR / "price_reliability" / "stale_test_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log(f"done in {report['seconds']} s; decision: { {c: d['replace_with'] for c, d in decision.items()} }")


def sixty_day(df: pd.DataFrame, crop: str) -> pd.DataFrame:
    """Per candidate: MAE per fold over all 60 days, their mean, and the pooled 60-day MAE / WAPE (cases of all folds and bands)."""
    g = df[(df["crop"] == crop) & df["band"].isin(BANDS)].assign(s=lambda x: x["mae"] * x["n"],
                                                                  t=lambda x: x["mae"] * x["n"] / (x["wape_pct"] / 100))
    per = g.groupby(["candidate", "split"])[["s", "n"]].sum()
    out = (per["s"] / per["n"]).unstack("split")[["C", "A", "T"]]
    out["mean_fold_mae"] = out.mean(axis=1)
    tot = g.groupby("candidate")[["s", "n", "t"]].sum()
    out["mae"], out["wape_pct"], out["n"] = tot["s"] / tot["n"], 100 * tot["s"] / tot["t"], tot["n"]
    return out.sort_values("mean_fold_mae")


def decide(w: pd.DataFrame) -> dict:
    """Replace the current method only by a candidate at least MARGIN_PCT better on the mean fold MAE and better in two of three folds."""
    cur = w.loc["pooled_prod"]
    ok = [c for c in w.index if c != "pooled_prod"
          and w.loc[c, "mean_fold_mae"] <= cur["mean_fold_mae"] * (1 - MARGIN_PCT / 100)
          and int((w.loc[c, ["C", "A", "T"]] < cur[["C", "A", "T"]]).sum()) >= 2]
    best = min(ok, key=lambda c: w.loc[c, "mean_fold_mae"]) if ok else None
    near = w.index[0]
    return {"replace_with": best, "lowest_mean_mae": near,
            "lowest_vs_current_pct": round(100 * (1 - w.loc[near, "mean_fold_mae"] / cur["mean_fold_mae"]), 2)}


def render(r: dict, df: pd.DataFrame) -> str:
    md = ["# Stale-records walk-forward evaluation (Onion, Potato, Tomato)", "",
          f"Generated {r['created']} by `scripts/evaluate_stale_forecasts.py`. Records end {r['gap_days']} days before each forecast start; every model "
          "is trained only on targets before the fold's earliest end of records. MAE / WAPE in Rs per quintal; lower is better.", ""]
    for crop in CROPS:
        md += [f"## {crop}", "", "| band | candidate | MAE C | MAE A | MAE T | mean MAE | WAPE % C / A / T |", "|---|---|---|---|---|---|---|"]
        g = df[df["crop"] == crop]
        for band in [*BANDS, "46-60"]:
            gb = g[g["band"] == band]
            if gb.empty:
                continue
            for cand, gc in sorted(gb.groupby("candidate"), key=lambda x: x[1]["mae"].mean()):
                s = gc.set_index("split")
                md.append(f"| {band} | {cand} | " + " | ".join(f"{s['mae'].get(k, float('nan')):,.0f}" for k in "CAT")
                          + f" | {gc['mae'].mean():,.0f} | " + " / ".join(f"{s['wape_pct'].get(k, float('nan')):.0f}" for k in "CAT") + " |")
        md.append("")
    md += ["## Starting price against the price reported on the start day", "", "| crop | start | MAE C / A / T | WAPE % C / A / T |", "|---|---|---|---|"]
    sp = pd.DataFrame(r["start_price"])
    for (crop, start), g in sp.groupby(["crop", "start"]):
        s = g.set_index("split")
        md.append(f"| {crop} | {start} | " + " / ".join(f"{s['mae'][k]:,.0f}" for k in "CAT") + " | " + " / ".join(f"{s['wape_pct'][k]:.0f}" for k in "CAT") + " |")
    md += ["", "## One method for all 60 days (the app's current method is pooled_prod)", "",
           f"Replace the current method only with a candidate at least +{r['margin_pct']:.0f}% better on the mean fold MAE and better in two of three folds.", ""]
    for crop, w in r["sixty_day"].items():
        md += [f"### {crop}", "", "| candidate | MAE C | MAE A | MAE T | mean fold MAE | WAPE % (all folds) |", "|---|---|---|---|---|---|"]
        for cand, v in w.items():
            md.append(f"| {cand} | {v['C']:,.0f} | {v['A']:,.0f} | {v['T']:,.0f} | {v['mean_fold_mae']:,.0f} | {v['wape_pct']:.0f} |")
        d = r["decision"][crop]
        md += ["", f"Decision: {'replace with ' + d['replace_with'] if d['replace_with'] else 'keep the current method'} "
                   f"(lowest mean MAE: {d['lowest_mean_mae']}, {d['lowest_vs_current_pct']:+.1f}% vs current).", ""]
    return "\n".join(md) + "\n"


if __name__ == "__main__":
    main()
