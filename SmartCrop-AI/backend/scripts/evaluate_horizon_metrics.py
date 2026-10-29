"""Per-horizon evaluation of Onion, Potato and Tomato: MAE, RMSE, R2, WAPE and skill against naive baselines, by fold and scenario.

Run from backend/:   python -m scripts.evaluate_horizon_metrics

Nothing here changes a deployed artifact, the policy or a threshold. It writes dataset/reports/horizon_eval_onion_potato_tomato.json and .md.
Earlier searches (experiment_hard_crops / _forecast_v2 / _forecast_v3) reported only MAE skill on other bands; this script adds the remaining
metrics on the 1-12 / 13-30 / 31-60 day bands and measures how wrong the projected starting price itself is.

Folds (same as scripts/experiment_hard_crops.py; nothing is shuffled across time):
  C  train pairs whose TARGET date is before 2024-07-01, score origins 2024-07-01 .. 2024-12-31
  A  train pairs whose TARGET date is before 2025-01-01, score origins 2025-01-01 .. 2025-06-30
  T  train pairs whose TARGET date is before 2025-07-01, score origins 2025-07-01 .. 2025-12-31
Every model is fitted inside its fold on those pairs only. Features at an origin use only reports up to that day (features.py).

Scenarios
  real_origin  the forecast starts from the price actually reported on the origin day (what the app does once records are recent)
  projection   the forecast starts on day o but the newest records are one year older: inputs are from o - 1 year and the starting price is that
               day's price x 1.05 (how the app serves every request while records end on 31 Dec 2025). Truth = the price reported at o + h.

Candidates
  no_change       price stays at the starting price (the baseline of the +2 % rule)
  seasonal_med    median change over the same calendar window in earlier years (real_origin only; windows end before the scored period)
  pooled_prod     production architecture: one model for all 7 crops, the production hyper-parameters and, per horizon, the production
                  candidate (rf_plain / rf_rate / xgb_rate from metadata.json horizon_models)
  crop_xgb        XGBoost for this crop and band only (experiment_hard_crops settings)
  crop_xgb_half   crop_xgb with its predicted change halved
  crop_rf         Random Forest for this crop and band only

Metrics (price space, Rs/quintal, err = predicted - actual): MAE, RMSE, WAPE = sum|err| / sum actual, skill = 1 - MAE / MAE(no_change).
R2 is computed on the CHANGE log(actual / start) against the predicted change: R2 on price levels is near 1 for every method (markets differ
in level far more than prices move) and says nothing about forecasting skill. One sampling seed; the production adoption rule (scripts/
train_crop_band_models.py) additionally needs three seeds, so a cell flagged here is a lead, not a deployment.
"""
from __future__ import annotations

import json
import time
import warnings
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from app.ml.common import paths
from app.ml.price_prediction.features import (MAX_HORIZON, MODEL_FEATURES, SERIES_KEY, STATE_MARKET, compute_features,
                                              target_log_change, usable_origin_mask, with_pair_features)
from scripts.experiment_hard_crops import LEVEL, MARGIN_PCT, SPLITS, fit_xgb
from scripts.train_price_model import fit as fit_prod, predict as predict_prod

warnings.filterwarnings("ignore")
CROPS = ["Onion", "Potato", "Tomato"]
BANDS = {"1-12": (1, 12), "13-30": (13, 30), "31-60": (31, 60)}
SEED = 42
H_PER_ORIGIN = 3
MAX_CROP_TRAIN = 150_000
MAX_POOLED_TRAIN = 400_000      # production N_TRAIN_PAIRS
CROP_FEATURES = [c for c in MODEL_FEATURES if c != "commodity_code"]
OUT = "horizon_eval_onion_potato_tomato"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Data:
    def __init__(self) -> None:
        prep = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")
        panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
        for c in SERIES_KEY:
            panel[c] = panel[c].astype(str)
        self.feat = compute_features(panel, prep["encoders"], with_targets=True).reset_index(drop=True)
        self.mask = usable_origin_mask(self.feat).to_numpy()
        self._tlc: dict[int, np.ndarray] = {}

    def tlc(self, h: int) -> np.ndarray:
        if h not in self._tlc:
            self._tlc[h] = target_log_change(self.feat, h).to_numpy().astype("float32")
        return self._tlc[h]

    def pairs(self, rng, crops, lo, hi, origin_from=None, origin_to=None, target_before=None, reps=H_PER_ORIGIN):
        """(X with MODEL_FEATURES, log change y, start price, origin date, h) for origins of ``crops`` and horizons in [lo, hi]."""
        f = self.feat
        sel = self.mask & f["Commodity"].isin(crops).to_numpy()
        if origin_from is not None:
            sel &= ((f["Date"] >= origin_from) & (f["Date"] <= origin_to)).to_numpy()
        idx = np.flatnonzero(sel)
        base = f.iloc[idx]
        out = []
        for _ in range(reps):
            h = rng.integers(lo, hi + 1, size=len(idx))
            y = np.full(len(idx), np.nan)
            for hv in np.unique(h):
                y[h == hv] = self.tlc(int(hv))[idx[h == hv]]
            ok = np.isfinite(y)
            if target_before is not None:
                ok &= (base["Date"].to_numpy().astype("datetime64[D]") + h.astype("timedelta64[D]")) < np.datetime64(target_before)
            X = with_pair_features(base, h)[MODEL_FEATURES]
            out.append((X[ok], y[ok], np.exp(base["log_price"].to_numpy()[ok]), base["Date"].to_numpy()[ok], h[ok]))
        return (pd.concat([o[0] for o in out], ignore_index=True), *(np.concatenate([o[i] for o in out]) for i in range(1, 5)))

    def projection_pairs(self, rng, crop, lo, hi, o_from, o_to):
        """Inputs from o - 1 year, start = that price x LEVEL, truth = price reported at o + h; also the price reported on o itself (or NaN)."""
        f = self.feat
        lo_d, hi_d = pd.Timestamp(o_from) - pd.DateOffset(years=1), pd.Timestamp(o_to) - pd.DateOffset(years=1)
        sel = self.mask & (f["Commodity"] == crop).to_numpy() & ((f["Date"] >= lo_d) & (f["Date"] <= hi_d)).to_numpy()
        ref = f[sel]
        look = f[[*SERIES_KEY, "Date", "target_price"]]
        out = []
        for _ in range(H_PER_ORIGIN):
            h = rng.integers(lo, hi + 1, size=len(ref))
            k = ref[[*SERIES_KEY, "Date", "log_price"]].copy()
            k["_i"] = np.arange(len(k))
            k["odate"] = k["Date"] + pd.DateOffset(years=1)
            k["tdate"] = k["odate"] + pd.to_timedelta(h, unit="D")
            k = (k.merge(look.rename(columns={"Date": "tdate", "target_price": "truth"}), on=[*SERIES_KEY, "tdate"], how="left")
                  .merge(look.rename(columns={"Date": "odate", "target_price": "actual_start"}), on=[*SERIES_KEY, "odate"], how="left")
                  .sort_values("_i"))
            ok = k["truth"].notna().to_numpy()
            X = with_pair_features(ref, h)[MODEL_FEATURES]
            out.append((X[ok], np.exp(k["log_price"].to_numpy()[ok]) * LEVEL, k["truth"].to_numpy()[ok], k["actual_start"].to_numpy()[ok], h[ok]))
        return (pd.concat([o[0] for o in out], ignore_index=True), *(np.concatenate([o[i] for o in out]) for i in range(1, 5)))

    def seasonal(self, crop, origin_dates, hs, before):
        """Median log change over the same calendar window 1-3 years earlier (state-median series), windows ending before ``before``."""
        s = self.feat[(self.feat["Commodity"] == crop) & (self.feat["Market"] == STATE_MARKET)].set_index("Date")["price"].ffill(limit=7)
        full = np.log(s).reindex(pd.date_range(s.index.min(), s.index.max(), freq="D"))
        od = pd.DatetimeIndex(pd.to_datetime(origin_dates))
        stack = []
        for yrs in (1, 2, 3):
            a = od - pd.DateOffset(years=yrs)
            b = a + pd.to_timedelta(hs, unit="D")
            va, vb = full.reindex(a).to_numpy(), full.reindex(b).to_numpy()
            stack.append(np.where(np.isfinite(va) & np.isfinite(vb) & (b < pd.Timestamp(before)), vb - va, np.nan))
        with np.errstate(all="ignore"):
            med = np.nanmedian(np.vstack(stack), axis=0)
        return np.where(np.isfinite(med), med, 0.0)


def fit_rf(X, y, sample_weight=None):
    m = RandomForestRegressor(n_estimators=150, max_depth=10, min_samples_leaf=100, max_features=0.5, max_samples=0.5,
                              n_jobs=-1, random_state=SEED)
    return m.fit(X, y, sample_weight=sample_weight)


def metrics(start, truth, pred_log, base_mae) -> dict:
    pred = start * np.exp(pred_log)
    err = pred - truth
    y = np.log(truth / start)
    sst = float(np.sum((y - y.mean()) ** 2))
    m = float(np.mean(np.abs(err)))
    return {"mae": round(m, 1), "rmse": round(float(np.sqrt(np.mean(err ** 2))), 1),
            "wape_pct": round(100 * float(np.sum(np.abs(err)) / np.sum(truth)), 2),
            "r2_change": round(1 - float(np.sum((y - pred_log) ** 2)) / sst, 3) if sst > 0 else None,
            "skill_pct": round(100 * (1 - m / base_mae), 2)}


class Pooled:
    """Production architecture refitted inside a fold: rf_plain, rf_rate, xgb_rate on all 7 crops, chosen per horizon as in production."""

    def __init__(self, data: Data, rng, before: str) -> None:
        meta = json.loads((paths.PRICE_MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
        self.choice = {int(h): c for h, c in meta["horizon_models"].items()}
        X, y, *_ = data.pairs(rng, sorted(data.feat["Commodity"].unique()), 1, MAX_HORIZON, target_before=before, reps=1)
        if len(y) > MAX_POOLED_TRAIN:
            keep = rng.choice(len(y), MAX_POOLED_TRAIN, replace=False)
            X, y = X.iloc[keep], y[keep]
        self.models = {c: fit_prod(c, X, y) for c in sorted(set(self.choice.values()))}

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        h = X["horizon_days"].to_numpy().astype(int)
        out = np.zeros(len(X))
        for c, m in self.models.items():
            rows = np.array([self.choice[k] == c for k in h])
            if rows.any():
                out[rows] = predict_prod(c, m, X[rows])
        return out


def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    data = Data()
    log(f"features ready: {int(data.mask.sum()):,} usable origins")
    rows, start_rows, drift_rows = [], [], []
    for split, (before, o_from, o_to) in SPLITS.items():
        pooled = Pooled(data, rng, before)
        log(f"split {split}: pooled production models fitted")
        for crop in CROPS:
            for band, (lo, hi) in BANDS.items():
                Xtr, ytr, *_ = data.pairs(rng, [crop], lo, hi, target_before=before)
                if len(ytr) > MAX_CROP_TRAIN:
                    keep = rng.choice(len(ytr), MAX_CROP_TRAIN, replace=False)
                    Xtr, ytr = Xtr.iloc[keep], ytr[keep]
                xgb, rf = fit_xgb(Xtr[CROP_FEATURES], ytr), fit_rf(Xtr[CROP_FEATURES], ytr)

                def candidates(X):
                    px = xgb.predict(X[CROP_FEATURES])
                    return {"pooled_prod": pooled.predict(X), "crop_xgb": px, "crop_xgb_half": 0.5 * px, "crop_rf": rf.predict(X[CROP_FEATURES])}

                # real origin
                X, y, p0, od, h = data.pairs(rng, [crop], lo, hi, origin_from=o_from, origin_to=o_to)
                truth = p0 * np.exp(y)
                preds = {"no_change": np.zeros(len(y)), "seasonal_med": data.seasonal(crop, od, h, o_from), **candidates(X)}
                base = float(np.mean(np.abs(p0 - truth)))
                for c, p in preds.items():
                    rows.append({"crop": crop, "band": band, "split": split, "scenario": "real_origin", "candidate": c, "n": int(len(y)),
                                 **metrics(p0, truth, p, base)})
                if band == "31-60" and split == "T":
                    for c in ("crop_xgb", "pooled_prod"):
                        q = np.percentile(preds[c], [5, 50, 95])
                        drift_rows.append({"crop": crop, "candidate": c, "pred_change_pct_p5_p50_p95": [round(100 * (np.exp(v) - 1), 1) for v in q]})
                    q = np.percentile(y, [5, 50, 95])
                    drift_rows.append({"crop": crop, "candidate": "actual", "pred_change_pct_p5_p50_p95": [round(100 * (np.exp(v) - 1), 1) for v in q]})
                # projection
                X, start, truth, actual_start, h = data.projection_pairs(rng, crop, lo, hi, o_from, o_to)
                if len(truth) >= 500:
                    preds = {"no_change": np.zeros(len(truth)), **candidates(X)}
                    base = float(np.mean(np.abs(start - truth)))
                    for c, p in preds.items():
                        rows.append({"crop": crop, "band": band, "split": split, "scenario": "projection", "candidate": c, "n": int(len(truth)),
                                     **metrics(start, truth, p, base)})
                    if band == "1-12":   # how far the projected starting price is from the price really reported on the start day
                        ok = np.isfinite(actual_start)
                        r = start[ok] / actual_start[ok]
                        start_rows.append({"crop": crop, "split": split, "n": int(ok.sum()),
                                           "start_mae": round(float(np.mean(np.abs(start[ok] - actual_start[ok]))), 1),
                                           "start_wape_pct": round(100 * float(np.sum(np.abs(start[ok] - actual_start[ok])) / np.sum(actual_start[ok])), 1),
                                           "ratio_p10_p50_p90": [round(float(v), 2) for v in np.percentile(r, [10, 50, 90])]})
                log(f"{split} {crop} {band}: done")
    df = pd.DataFrame(rows)
    leads = []
    for (crop, band, cand), g in df[~df["candidate"].isin(["no_change"])].groupby(["crop", "band", "candidate"]):
        s = g.set_index(["split", "scenario"])["skill_pct"]
        need = [(k, sc) for k in "CAT" for sc in ("real_origin", "projection")]
        if all(n in s.index for n in need) and all(s[n] >= MARGIN_PCT for n in need):
            leads.append({"crop": crop, "band": band, "candidate": cand, "worst_skill_pct": float(min(s[n] for n in need))})
    report = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "splits": SPLITS, "bands": BANDS, "margin_pct": MARGIN_PCT,
              "level_assumption": LEVEL, "rows": rows, "start_price_error": start_rows, "drift_31_60_T": drift_rows, "leads": leads,
              "seconds": round(time.time() - t0)}
    (paths.REPORTS_DIR / f"{OUT}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    (paths.REPORTS_DIR / f"{OUT}.md").write_text(render(report, df), encoding="utf-8")
    log(f"done in {report['seconds']} s; leads: {leads or 'none'}")


def render(r: dict, df: pd.DataFrame) -> str:
    md = ["# Onion, Potato, Tomato: per-horizon evaluation (1-12 / 13-30 / 31-60 days)", "",
          f"Generated {r['created']} by `scripts/evaluate_horizon_metrics.py` (read-only; nothing deployed changed). Folds C / A / T as in "
          "`experiment_hard_crops.py`; every model is fitted inside its fold. Skill = 1 - MAE / MAE(no change); the app's rule needs >= "
          f"+{r['margin_pct']:.0f}% in all three folds AND both scenarios. R2 is on the price CHANGE (see the script docstring).", ""]
    for scen, title in (("real_origin", "Real origin (forecast starts from a price reported that day)"),
                        ("projection", "Projection (records one year older, start = that price x1.05; how the app runs today)")):
        md += [f"## {title}", "", "| crop | band | fold | n | candidate | MAE | RMSE | WAPE % | R2 (change) | skill vs no change |",
               "|---|---|---|---|---|---|---|---|---|---|"]
        for _, x in df[df["scenario"] == scen].sort_values(["crop", "band", "split", "candidate"]).iterrows():
            md.append(f"| {x.crop} | {x.band} | {x.split} | {x.n:,} | {x.candidate} | {x.mae:,.0f} | {x.rmse:,.0f} | {x.wape_pct:.1f} | "
                      f"{'' if x.r2_change is None or pd.isna(x.r2_change) else f'{x.r2_change:+.3f}'} | {x.skill_pct:+.1f}% |")
        md.append("")
    md += ["## Best candidate per crop and band (worst skill over folds C / A / T)", "", "| crop | band | real origin: best (worst fold) | projection: best (worst fold) |", "|---|---|---|---|"]
    for (crop, band), g in df[df["candidate"] != "no_change"].groupby(["crop", "band"]):
        cells = []
        for scen in ("real_origin", "projection"):
            w = g[g["scenario"] == scen].groupby("candidate")["skill_pct"].min()
            cells.append(f"{w.idxmax()} ({w.max():+.1f}%)" if len(w) else "-")
        md.append(f"| {crop} | {band} | {cells[0]} | {cells[1]} |")
    md += ["", "## How wrong is the projected starting price? (last year's price x1.05 against the price reported on the start day)", "",
           "| crop | fold | n | MAE | WAPE % | projected / actual, p10 / p50 / p90 |", "|---|---|---|---|---|---|"]
    md += [f"| {s['crop']} | {s['split']} | {s['n']:,} | {s['start_mae']:,.0f} | {s['start_wape_pct']:.1f} | {' / '.join(map(str, s['ratio_p10_p50_p90']))} |"
           for s in r["start_price_error"]]
    md += ["", "## Drift: predicted vs actual change over 31-60 days (test fold T, real origin), % p5 / p50 / p95", "",
           "| crop | series | p5 / p50 / p95 |", "|---|---|---|"]
    md += [f"| {d['crop']} | {d['candidate']} | {' / '.join(f'{v:+.1f}' for v in d['pred_change_pct_p5_p50_p95'])} |" for d in r["drift_31_60_T"]]
    md += ["", "## Cells clearing the rule in all six scores (one seed; would still need the three-seed check)", ""]
    md += [f"* {x['crop']} {x['band']}: {x['candidate']} (worst {x['worst_skill_pct']:+.1f}%)" for x in r["leads"]] or ["None."]
    return "\n".join(md) + "\n"


if __name__ == "__main__":
    main()
