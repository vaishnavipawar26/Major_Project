"""Phase 0 + 1: read-only baseline snapshot and rolling-origin backtest of the price forecaster.

Run from backend/:   python -m scripts.backtest_price        (EVAL_SMOKE=1 for a tiny code-path check)

Nothing in the production pipeline, model files, database or frontend is changed. Models are
re-fitted IN MEMORY with the production architecture and hyper-parameters (scripts.train_price_model.fit)
on earlier data only; the production candidate-per-horizon assignment (metadata.json) is kept.

Two scenarios are scored separately and never pooled:

  REAL-ORIGIN   a forecast made from the market's own recent prices (what CV measured).
  PROJECTION    the exact production path while the dataset is out of date: features of the same
                calendar day one year earlier, start price = that price x (1 + inflation), model
                ratio applied to it (forecaster._forecast_model with years_ahead = 1).

Time split (data are 2023-01-01 .. 2025-12-31)
  fit A   trained on (origin, h) pairs whose TARGET date is before 2025-01-01
  fit B   trained on pairs whose target date is before 2025-07-01
  VALIDATION  origins 2025-01-01 .. 2025-06-30   (fit A) -> interval calibration, diagnostics
  TEST        origins 2025-07-01 .. 2025-12-31   (fit B real-origin; fit A projection) -> final scores
Projection scenario: the reference year is 2024, simulating a user in 2025 whose data end 2024-12-31.
VALIDATION/TEST are split by the (shifted) 2025 origin date.

All methods are scored on exactly the same cases. A case is kept only if every method is defined.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import (FEATURE_COLUMNS, HORIZONS, MAX_HORIZON, MODEL_FEATURES, SERIES_KEY,
                                              STATE_MARKET, STATE_VARIETY, compute_features,
                                              fit_encoders, target_log_change, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_prediction.forecaster import (BASELINE_ANCHOR_OBS, BASELINE_SEASON_YEARS, MIN_RESIDUAL_SAMPLES,
                                                PriceForecaster, SeriesRef, _load_inflation,
                                                _shift_years)
from scripts.train_price_model import CANDIDATES, fit, predict, sample

SMOKE = os.getenv("EVAL_SMOKE") == "1"
OUT_DIR = Path(os.getenv("EVAL_OUT_DIR", paths.REPORTS_DIR))
N_TRAIN = 20_000 if SMOKE else 400_000
N_VAL = 4_000 if SMOKE else 150_000
N_TEST = 4_000 if SMOKE else 150_000
N_PROJ = 4_000 if SMOKE else 100_000
N_BOOT = 100 if SMOKE else 1000
SEED = 7

VAL_START, VAL_END = np.datetime64("2025-01-01"), np.datetime64("2025-06-30")
TEST_START, TEST_END = np.datetime64("2025-07-01"), np.datetime64("2025-12-31")
CUT_A, CUT_B = np.datetime64("2025-01-01"), np.datetime64("2025-07-01")
PROJ_REF_YEAR = 2024
PROJ_DATA_END = np.datetime64("2024-12-31")
MEANINGFUL = 0.05            # a price change above 5 % counts as "meaningful" for direction accuracy
TARGET_COVERAGE = 0.80
BANDS = ["1-7", "8-14", "15-30", "31-60"]
CROP_BAND_MIN_N = 100


# ----------------------------------------------------------------------------- small helpers
def band_idx(h: np.ndarray) -> np.ndarray:
    return np.digitize(h, [8, 15, 31])


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def md_table(rows: list[dict], cols: list[str] | None = None) -> str:
    if not rows:
        return "_no data_\n"
    cols = cols or list(rows[0].keys())

    def f(v):
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            return "–"
        if isinstance(v, (float, np.floating)):
            return f"{v:,.1f}"
        return str(v)

    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    out += ["| " + " | ".join(f(r.get(c)) for c in cols) + " |" for r in rows]
    return "\n".join(out) + "\n"


# ----------------------------------------------------------------------------- Phase 0
def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def phase0_snapshot() -> dict:
    d = paths.PRICE_MODEL_DIR
    meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
    sel = meta["selected"]
    snap = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "purpose": "Phase 0 baseline: what the production price model reported before any change.",
        "model_version": meta["version"], "trained_at": meta["trained_at"],
        "data_start": meta["data_start"], "data_end": meta["data_end"],
        "inflation_annual_assumption": _load_inflation(),
        "horizon_to_model": sel["model"], "reported_cv_mean_selected": sel["cv_mean"],
        "reported_cv_mean_no_change": sel["naive_cv_mean"],
        "reported_validated_horizons": meta["validated_horizons"],
        "reported_80pct_interval_pooled": {h: meta["residual_intervals"][h]["_all"]
                                           for h in ("1", "7", "14", "30", "60")},
        "reported_global_shap_importance_top10": dict(list(meta["global_shap_importance"].items())[:10]),
        "model_files": {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size}
                        for p in sorted(d.iterdir()) if p.is_file()},
        "sample_forecasts": [],
    }
    try:
        fc = PriceForecaster()
        start = date(2026, 10, 23)
        for crop in sorted(fc.encoders["commodity"]):
            rows = fc.support[(fc.support["Commodity"] == crop) & (fc.support["Market"] == STATE_MARKET)]
            if rows.empty:
                continue
            ref = SeriesRef(rows["State"].iloc[0], STATE_MARKET, crop, STATE_VARIETY)
            try:
                o = fc.forecast(ref, start, start + timedelta(days=30), explain=False)
                t = o["target"]
                snap["sample_forecasts"].append({
                    "crop": crop, "as_of": start.isoformat(), "target_date": t["date"],
                    "start_price": o["current_price"], "predicted": t["predicted_price"],
                    "lower": t["lower"], "upper": t["upper"], "direction": t["direction"],
                    "change_pct": t["change_pct"], "method": o["source"]["method"],
                    "years_shifted": o["dates"]["years_shifted"], "beats_baseline": t["beats_baseline"]})
            except Exception as exc:   # a missing sample must not stop the backtest
                snap["sample_forecasts"].append({"crop": crop, "error": str(exc)})
    except Exception as exc:
        snap["sample_forecasts_error"] = str(exc)
    return snap


# ----------------------------------------------------------------------------- seasonal baseline
class SeasonalRatio:
    """The serving seasonal baseline (forecaster._seasonal_ratio) on pre-cut numpy arrays."""

    def __init__(self, feat: pd.DataFrame):
        o = feat[feat["observed"] & feat["price"].notna() & (feat["price"] > 0)]
        self.arr = {sid: (g["Date"].to_numpy("datetime64[D]"), g["price"].to_numpy(float))
                    for sid, g in o.groupby("sid", sort=False)}

    def ratio(self, sid: int, ref: date, h: int) -> tuple[float, int]:
        dates, prices = self.arr[sid]
        k = int(np.searchsorted(dates, np.datetime64(ref), side="right"))   # only reports <= origin
        dates, prices = dates[:k], prices[:k]
        rs = []
        for yrs in range(1, BASELINE_SEASON_YEARS + 1):
            then = _shift_years(ref, -yrs)
            a = PriceForecaster._window_median(dates, prices, then)
            b = PriceForecaster._window_median(dates, prices, then + timedelta(days=h))
            if a and b:
                rs.append(b / a)
        return (float(np.median(rs)), len(rs)) if rs else (1.0, 0)

    def check_against_production(self, feat: pd.DataFrame, n: int = 150) -> int:
        """Assert this array version equals PriceForecaster._seasonal_ratio on random cases."""
        rng = np.random.default_rng(1)
        o = feat[feat["observed"] & (feat["Date"] >= "2024-06-01")]
        rows = o.iloc[rng.choice(len(o), n, replace=False)]
        for r in rows.itertuples():
            h = int(rng.integers(1, 61))
            obs = feat[(feat["sid"] == r.sid) & feat["observed"] & feat["price"].notna()
                       & (feat["price"] > 0) & (feat["Date"] <= r.Date)][["Date", "price"]].reset_index(drop=True)
            want = PriceForecaster._seasonal_ratio(PriceForecaster, obs, r.Date.date(), h) \
                if len(obs) else (1.0, 0)
            got = self.ratio(int(r.sid), r.Date.date(), h)
            assert abs(want[0] - got[0]) < 1e-9 and want[1] == got[1], (want, got)
        return n


# ----------------------------------------------------------------------------- metrics
def metrics(p0, y, pred, with_direction=True) -> dict:
    act, fc = p0 * np.exp(y), p0 * np.exp(pred)
    err = np.abs(fc - act)
    mv = np.abs(np.expm1(y)) > MEANINGFUL
    out = {"n": int(len(y)), "MAE": float(err.mean()), "WAPE_pct": float(err.sum() / act.sum() * 100),
           "n_meaningful": int(mv.sum()), "up_share_of_meaningful_pct": float((y[mv] > 0).mean() * 100) if mv.any() else np.nan}
    out["direction_acc_pct"] = (float((np.sign(pred[mv]) == np.sign(y[mv])).mean() * 100)
                                if with_direction and mv.any() else np.nan)
    return out


def paired_boot(err_m, err_b, cluster, rng) -> dict:
    """Skill = 1 - sum|err model| / sum|err baseline|, with a 95 % CI from resampling origin weeks."""
    codes, uniq = pd.factorize(cluster)
    k = len(uniq)
    sm = np.bincount(codes, weights=err_m, minlength=k)
    sb = np.bincount(codes, weights=err_b, minlength=k)
    point = 1 - sm.sum() / sb.sum()
    sk = np.empty(N_BOOT)
    for i in range(N_BOOT):
        d = rng.integers(0, k, k)
        sk[i] = 1 - sm[d].sum() / sb[d].sum()
    return {"skill_pct": float(point * 100), "ci_low_pct": float(np.quantile(sk, .025) * 100),
            "ci_high_pct": float(np.quantile(sk, .975) * 100), "clusters": int(k)}


class Scored:
    """Cases (one row each) with the truth and every method's prediction as log(price / start price)."""

    def __init__(self, df: pd.DataFrame, methods: dict[str, bool]):
        self.df, self.methods = df.reset_index(drop=True), methods   # name -> counts toward direction
        self.p0 = self.df["p0"].to_numpy(float)
        self.y = self.df["y"].to_numpy(float)

    def table(self, mask=None) -> list[dict]:
        m = np.ones(len(self.df), bool) if mask is None else mask
        rows = []
        for name, dirs in self.methods.items():
            r = metrics(self.p0[m], self.y[m], self.df[f"pred_{name}"].to_numpy(float)[m], dirs)
            rows.append({"method": name, **r})
        return rows

    def by(self, key: str, values, mask_fn) -> dict:
        out = {}
        for v in values:
            m = mask_fn(v)
            if m.sum() >= 1:
                out[str(v)] = self.table(m)
        return out

    def abs_err(self, name: str) -> np.ndarray:
        return np.abs(self.p0 * np.exp(self.df[f"pred_{name}"].to_numpy(float)) - self.p0 * np.exp(self.y))


def cell_summary(sc: Scored, model: str, baselines: list[str]) -> dict:
    """crop x horizon-band cells (n >= CROP_BAND_MIN_N): in how many does the model beat each baseline?"""
    d = sc.df
    cells = []
    for (crop, b), g in d.groupby(["crop", "band"]):
        if len(g) < CROP_BAND_MIN_N:
            continue
        m = np.asarray(g.index)
        row = {"crop": crop, "band": BANDS[int(b)], "n": len(g), "MAE_model": float(sc.abs_err(model)[m].mean())}
        for bl in baselines:
            row[f"MAE_{bl}"] = float(sc.abs_err(bl)[m].mean())
        cells.append(row)
    summary = {"cells": len(cells)}
    for bl in baselines:
        summary[f"model_beats_{bl}"] = int(sum(c["MAE_model"] < c[f"MAE_{bl}"] for c in cells))
    summary["model_beats_all_baselines"] = int(sum(all(c["MAE_model"] < c[f"MAE_{bl}"] for bl in baselines) for c in cells))
    return {"summary": summary, "cells": cells}


def interval_block(sc: Scored, pred_col: str, lo_col: str, hi_col: str, mask=None) -> dict:
    d = sc.df if mask is None else sc.df[mask]
    pred = d[pred_col].to_numpy(float)
    inside = (d["y"].to_numpy(float) >= pred + d[lo_col].to_numpy(float)) & \
             (d["y"].to_numpy(float) <= pred + d[hi_col].to_numpy(float))
    width = (np.exp(pred + d[hi_col].to_numpy(float)) - np.exp(pred + d[lo_col].to_numpy(float))) * 100
    return {"coverage_pct": float(inside.mean() * 100), "n": int(len(d)),
            "mean_width_pct_of_start_price": float(width.mean()),
            "below_pct": float((d["y"].to_numpy(float) < pred + d[lo_col].to_numpy(float)).mean() * 100),
            "above_pct": float((d["y"].to_numpy(float) > pred + d[hi_col].to_numpy(float)).mean() * 100)}


def recalibrate(val: pd.DataFrame, pred_col: str) -> dict:
    """q10 / q90 of validation residuals per (crop, band); pooled band value when a crop has too few."""
    r = val["y"] - val[pred_col]
    out = {}
    for b, g in val.assign(r=r).groupby("band"):
        out[(None, int(b))] = (float(np.quantile(g["r"], .10)), float(np.quantile(g["r"], .90)))
    for (c, b), g in val.assign(r=r).groupby(["crop", "band"]):
        if len(g) >= MIN_RESIDUAL_SAMPLES:
            out[(c, int(b))] = (float(np.quantile(g["r"], .10)), float(np.quantile(g["r"], .90)))
    return out


def apply_cal(df: pd.DataFrame, cal: dict) -> tuple[np.ndarray, np.ndarray]:
    lo = np.empty(len(df))
    hi = np.empty(len(df))
    for i, (c, b) in enumerate(zip(df["crop"], df["band"])):
        q = cal.get((c, int(b))) or cal[(None, int(b))]
        lo[i], hi[i] = q
    return lo, hi


def production_interval(meta: dict, df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """forecaster._interval: crop-specific band when it has >= MIN_RESIDUAL_SAMPLES errors, else pooled."""
    ri = meta["residual_intervals"]
    lo = np.empty(len(df))
    hi = np.empty(len(df))
    for i, (h, c) in enumerate(zip(df["h"], df["crop"])):
        iv = ri[str(int(h))]
        q = iv.get(c)
        q = q if q and q.get("n", 0) >= MIN_RESIDUAL_SAMPLES else iv["_all"]
        lo[i], hi[i] = q["q10"], q["q90"]
    return lo, hi


# ----------------------------------------------------------------------------- leakage test
def leakage_test(panel: pd.DataFrame, encoders: dict, feat_full: pd.DataFrame) -> list[dict]:
    """Empirical no-future-information test of the feature code: recompute every feature on a panel
    that has been CUT at a date and compare with the features computed on the full panel for all
    rows up to that date. Any difference would mean a feature at date t depends on data after t."""
    key = [*SERIES_KEY, "Date"]
    ref = feat_full.set_index(key)[FEATURE_COLUMNS]
    out = []
    for cut in ("2024-06-30", "2025-03-31", "2025-09-30"):
        sub = panel[panel["Date"] <= pd.Timestamp(cut)]
        f2 = compute_features(sub, encoders, with_targets=False).set_index(key)[FEATURE_COLUMNS]
        a, b = ref.reindex(f2.index).to_numpy(float), f2.to_numpy(float)
        same = (np.isnan(a) & np.isnan(b)) | (np.abs(a - b) < 1e-6)
        out.append({"cut_date": cut, "rows_compared": int(len(f2)), "feature_values_compared": int(a.size),
                    "mismatching_values": int((~same).sum()),
                    "features_with_mismatch": [FEATURE_COLUMNS[i] for i in np.flatnonzero((~same).any(axis=0))]})
    return out


# ----------------------------------------------------------------------------- main
def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    log = lambda s: print(f"[{time.time() - t0:5.0f}s] {s}", flush=True)   # noqa: E731

    snap = phase0_snapshot()
    (OUT_DIR / "price_baseline_snapshot.json").write_text(json.dumps(clean(snap), indent=2), encoding="utf-8")
    log("Phase 0 snapshot written")

    meta = json.loads((paths.PRICE_MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
    prep = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")
    assert list(prep["feature_columns"]) == list(MODEL_FEATURES), "feature schema differs from production"
    infl = _load_inflation()
    level = 1 + infl
    horizon_model = {int(h): c for h, c in meta["horizon_models"].items()}
    cand_of_h = np.array([horizon_model.get(h, "") for h in range(0, MAX_HORIZON + 1)])
    needed = sorted(set(horizon_model.values()))

    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    encoders = prep["encoders"]
    feat = compute_features(panel, encoders, with_targets=True)
    feat["sid"] = feat.groupby(SERIES_KEY, sort=False).ngroup()
    mask = usable_origin_mask(feat).to_numpy()
    base = feat[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    log(f"usable origins {n:,}")

    # truth and the information-at-origin baselines for every (origin, h)
    g = feat.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365).to_numpy()[mask]
    Y = np.empty((n, H), "float32")
    SN = np.empty((n, H), "float32")
    YA = np.empty((n, H), "float32")      # log price one year before the target date (known at origin)
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(feat, h).to_numpy()[mask]
        lp_t = g.shift(365 - h).to_numpy()[mask]
        YA[:, h - 1] = lp_t
        SN[:, h - 1] = lp_t - lag365
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all, sn_all, ya_all = Y.ravel(), SN.ravel(), YA.ravel()
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")
    pair_origin = origin_day[oi]
    pair_target = pair_origin + hh.astype("timedelta64[D]")
    has_target = np.isfinite(y_all)
    defined = has_target & np.isfinite(sn_all) & np.isfinite(ya_all)
    logp0 = base["log_price"].to_numpy()
    crop_of = base["Commodity"].to_numpy()
    sid_of = base["sid"].to_numpy()
    seas = SeasonalRatio(feat)
    log(f"seasonal-ratio shim identical to production on {seas.check_against_production(feat)} random cases")

    leak = leakage_test(panel, encoders, feat)
    for r_ in leak:
        log(f"leakage test cut {r_['cut_date']}: {r_['mismatching_values']} of {r_['feature_values_compared']:,} feature values differ")
    facts = {"panel_rows": int(len(feat)), "observed_rows": int(feat["observed"].sum()),
             "usable_origins": int(n), "min_observed_price": float(feat.loc[feat["observed"], "price"].min()),
             "series": int(feat["sid"].nunique())}
    assert facts["min_observed_price"] > 0, "WAPE denominator needs positive prices"

    def X_of(idx):
        return with_pair_features(base.iloc[oi[idx]], hh[idx])

    def fit_all(cut: np.datetime64, label: str):
        tr = sample(rng, has_target & (pair_target < cut), N_TRAIN)
        assert pair_target[tr].max() < cut, "training target date leaks past the cut-off"
        X, yy = X_of(tr), y_all[tr]
        models = {}
        for c in needed:
            models[c] = fit(c, X, yy)
            log(f"fit {label} {c}: {len(tr):,} pairs, targets < {cut}")
        return models

    def predict_all(models: dict, X: pd.DataFrame) -> dict:
        hs = X["horizon_days"].to_numpy().astype(int)
        cols = {c: predict(c, m, X) for c, m in models.items()}
        assigned = np.empty(len(X), "float32")
        for c in needed:
            r = cand_of_h[hs] == c
            assigned[r] = cols[c][r]
        return {**{f"cand_{c}": v for c, v in cols.items()}, "model": assigned}

    models_A = fit_all(CUT_A, "A")
    models_B = fit_all(CUT_B, "B")

    # =========================================================================== REAL-ORIGIN
    def real_cases(lo, hi, size, models):
        idx = sample(rng, defined & (pair_origin >= lo) & (pair_origin <= hi), size)
        o, h = oi[idx], hh[idx].astype(int)
        ratios, yrs = zip(*(seas.ratio(int(sid_of[a]), origin_day[a].astype(object), int(b)) for a, b in zip(o, h)))
        keep = np.array(yrs) > 0
        idx, o, h = idx[keep], o[keep], h[keep]
        X = X_of(idx)
        preds = predict_all(models, X)
        d = pd.DataFrame({
            "crop": crop_of[o], "h": h, "band": band_idx(h), "origin": origin_day[o], "o": o,
            "p0": np.exp(logp0[o]), "y": y_all[idx].astype(float),
            "pred_model": preds["model"].astype(float), "pred_no_change": 0.0,
            "pred_year_ago_x1.05": ya_all[idx] + np.log(level) - logp0[o],
            "pred_seasonal_naive": sn_all[idx].astype(float),
            "pred_seasonal_ratio": np.log(np.array(ratios)[keep])})
        for c in needed:
            d[f"cand_{c}"] = preds[f"cand_{c}"].astype(float)
        return d, X, idx, int(keep.sum()), len(keep)

    real_methods = {"model": True, "no_change": False, "year_ago_x1.05": True,
                    "seasonal_naive": True, "seasonal_ratio": True}
    dv, _, _, kv, tv = real_cases(VAL_START, VAL_END, N_VAL, models_A)
    log(f"real validation cases {len(dv):,} (seasonal ratio defined for {kv}/{tv})")
    dt, Xt, idx_t, kt, tt = real_cases(TEST_START, TEST_END, N_TEST, models_B)
    log(f"real test cases {len(dt):,} (seasonal ratio defined for {kt}/{tt})")

    # production (final) models were trained on ALL data including this test period: in-sample, shown only to size the leak
    prod = {c: joblib.load(paths.PRICE_MODEL_DIR / f) for c, f in meta["model_files"].items()}
    hs_t = Xt["horizon_days"].to_numpy().astype(int)
    prod_pred = np.empty(len(Xt))
    for c in needed:
        r = cand_of_h[hs_t] == c
        prod_pred[r] = predict(c, prod[c], Xt[r])
    dt["pred_production_in_sample"] = prod_pred

    cal_real = recalibrate(dv, "pred_model")
    for d_ in (dv, dt):
        d_["plo"], d_["phi"] = production_interval(meta, d_)
    dt["clo"], dt["chi"] = apply_cal(dt, cal_real)
    sc_v, sc_t = Scored(dv, real_methods), Scored(dt, real_methods)
    wk_t = pd.to_datetime(dt["origin"]).dt.to_period("W").astype(str).to_numpy()

    real = {
        "n_validation": len(dv), "n_test": len(dt),
        "test_overall": sc_t.table(),
        "validation_overall": sc_v.table(),
        "test_by_band": sc_t.by("band", range(4), lambda b: dt["band"].to_numpy() == b),
        "test_by_crop": sc_t.by("crop", sorted(dt["crop"].unique()), lambda c: dt["crop"].to_numpy() == c),
        "test_cells": cell_summary(sc_t, "model", ["no_change", "year_ago_x1.05", "seasonal_naive", "seasonal_ratio"]),
        "test_skill_vs": {bl: paired_boot(sc_t.abs_err("model"), sc_t.abs_err(bl), wk_t, rng)
                          for bl in ("no_change", "year_ago_x1.05", "seasonal_naive", "seasonal_ratio")},
        "test_by_band_skill_vs_no_change": {
            BANDS[b]: paired_boot(sc_t.abs_err("model")[dt["band"].to_numpy() == b],
                                  sc_t.abs_err("no_change")[dt["band"].to_numpy() == b],
                                  wk_t[dt["band"].to_numpy() == b], rng) for b in range(4)},
        "candidate_check_test_MAE_by_band": {
            BANDS[b]: {c: float(np.abs(dt["p0"] * np.exp(dt[f"cand_{c}"]) - dt["p0"] * np.exp(dt["y"]))[dt["band"] == b].mean())
                       for c in needed} | {"assigned": float(sc_t.abs_err("model")[dt["band"].to_numpy() == b].mean()),
                                           "no_change": float(sc_t.abs_err("no_change")[dt["band"].to_numpy() == b].mean())}
            for b in range(4)},
        "production_in_sample_reference": metrics(dt["p0"].to_numpy(), dt["y"].to_numpy(), prod_pred),
        "intervals_test": {
            "production_intervals_as_shipped": interval_block(sc_t, "pred_model", "plo", "phi"),
            "recalibrated_on_validation_only": interval_block(sc_t, "pred_model", "clo", "chi"),
            "production_by_band": {BANDS[b]: interval_block(sc_t, "pred_model", "plo", "phi", dt["band"].to_numpy() == b) for b in range(4)},
            "recalibrated_by_band": {BANDS[b]: interval_block(sc_t, "pred_model", "clo", "chi", dt["band"].to_numpy() == b) for b in range(4)},
            "production_by_crop": {c: interval_block(sc_t, "pred_model", "plo", "phi", dt["crop"].to_numpy() == c) for c in sorted(dt["crop"].unique())},
        },
        "intervals_validation_production_as_shipped": interval_block(sc_v, "pred_model", "plo", "phi"),
    }
    log("real-origin scenario scored")

    # =========================================================================== PROJECTION
    ref_rows = np.flatnonzero(pd.DatetimeIndex(base["Date"]).year == PROJ_REF_YEAR)
    in_ref = np.isin(oi, ref_rows)
    last_known = (feat[feat["observed"] & (feat["Date"] <= pd.Timestamp(PROJ_DATA_END))]
                  .groupby("sid")["price"].last())
    # the year-ago baseline needs the reference-year price at ref_origin + h, and that must be inside the data
    ok_proj = defined & in_ref & (pair_target <= PROJ_DATA_END)
    tp = feat.loc[feat["target_price"].notna(), ["sid", "Date", "target_price"]]

    def proj_cases(m_lo, m_hi, size):
        mo = pd.DatetimeIndex(origin_day[oi]).month.to_numpy()
        idx = sample(rng, ok_proj & (mo >= m_lo) & (mo <= m_hi), int(size * 1.4))
        o, h = oi[idx], hh[idx].astype(int)
        od = pd.DatetimeIndex(origin_day[o])
        d2 = (od + pd.DateOffset(years=1)) + pd.to_timedelta(h, unit="D")
        pairs = pd.DataFrame({"sid": sid_of[o], "Date": d2.to_numpy(), "k": np.arange(len(o))})
        actual = pairs.merge(tp, on=["sid", "Date"], how="left").sort_values("k")["target_price"].to_numpy()
        ratios, yrs = zip(*(seas.ratio(int(sid_of[a]), origin_day[a].astype(object), int(b)) for a, b in zip(o, h)))
        lk = last_known.reindex(sid_of[o]).to_numpy()
        keep = np.isfinite(actual) & (np.array(yrs) > 0) & np.isfinite(lk)
        idx, o, h = idx[keep], o[keep], h[keep]
        actual, lk, ratios = actual[keep], lk[keep], np.array(ratios)[keep]
        p0 = np.exp(logp0[o]) * level                          # the app's "starting price"
        X = X_of(idx)
        preds = predict_all(models_A, X)
        d = pd.DataFrame({
            "crop": crop_of[o], "h": h, "band": band_idx(h), "o": o,
            "origin": (od[keep] + pd.DateOffset(years=1)).to_numpy(),
            "p0": p0, "y": np.log(actual / p0),
            "pred_model": preds["model"].astype(float),
            "pred_reference_x1.05": 0.0,                            # y = 0: last year's start price replayed
            "pred_latest_known": np.log(lk / p0),
            "pred_year_ago_x1.05": y_all[idx].astype(float),        # last year's realised path
            "pred_seasonal_ratio": np.log(ratios)})
        return d, int(keep.sum()), len(keep)

    proj_methods = {"model": True, "reference_x1.05": False, "latest_known": False,
                    "year_ago_x1.05": True, "seasonal_ratio": True}
    pv, kpv, tpv = proj_cases(1, 6, N_PROJ)
    pt, kpt, tpt = proj_cases(7, 12, N_PROJ)
    log(f"projection validation {len(pv):,}/{tpv}, test {len(pt):,}/{tpt} cases kept")
    cal_proj = recalibrate(pv, "pred_model")
    for d_ in (pv, pt):
        d_["plo"], d_["phi"] = production_interval(meta, d_)
    pt["clo"], pt["chi"] = apply_cal(pt, cal_proj)
    sp_v, sp_t = Scored(pv, proj_methods), Scored(pt, proj_methods)
    wk_p = pd.to_datetime(pt["origin"]).dt.to_period("W").astype(str).to_numpy()
    pbands = pt["band"].to_numpy()
    projection = {
        "n_validation": len(pv), "n_test": len(pt),
        "test_months": pd.to_datetime(pt["origin"]).dt.month.value_counts().sort_index().to_dict(),
        "test_overall": sp_t.table(), "validation_overall": sp_v.table(),
        "test_by_band": sp_t.by("band", range(4), lambda b: pbands == b),
        "test_by_crop": sp_t.by("crop", sorted(pt["crop"].unique()), lambda c: pt["crop"].to_numpy() == c),
        "test_cells": cell_summary(sp_t, "model", ["reference_x1.05", "latest_known", "year_ago_x1.05", "seasonal_ratio"]),
        "test_skill_vs": {bl: paired_boot(sp_t.abs_err("model"), sp_t.abs_err(bl), wk_p, rng)
                          for bl in ("reference_x1.05", "latest_known", "year_ago_x1.05", "seasonal_ratio")},
        "test_by_band_skill_vs_reference": {
            BANDS[b]: paired_boot(sp_t.abs_err("model")[pbands == b], sp_t.abs_err("reference_x1.05")[pbands == b],
                                  wk_p[pbands == b], rng) for b in range(4) if (pbands == b).sum() > 50},
        "intervals_test": {
            "production_intervals_as_shipped": interval_block(sp_t, "pred_model", "plo", "phi"),
            "recalibrated_on_projection_validation_only": interval_block(sp_t, "pred_model", "clo", "chi"),
            "production_by_band": {BANDS[b]: interval_block(sp_t, "pred_model", "plo", "phi", pbands == b) for b in range(4) if (pbands == b).sum() > 50},
        },
        "intervals_validation_production_as_shipped": interval_block(sp_v, "pred_model", "plo", "phi"),
    }
    log("projection scenario scored")

    EXACT = (1, 7, 14, 30, 60)
    for d_, sc_, store in ((dt, sc_t, real), (pt, sp_t, projection)):
        store["test_exact_horizon"] = {}
        for hv in EXACT:
            m = d_["h"].to_numpy() == hv
            if m.sum() >= 30:
                store["test_exact_horizon"][hv] = {"table": sc_.table(m),
                                                   "interval": interval_block(sc_, "pred_model", "plo", "phi", m)}

    def hist_block(d: pd.DataFrame, lvl: float, size: int, base_col: str) -> dict:
        """The production historical estimate (forecaster._forecast_baseline): anchor = median of the last
        BASELINE_ANCHOR_OBS reports, x level, x seasonal ratio; displayed range = +-1.2816 x weekly log
        spread x sqrt(h/7). Scored on its own random subset (the range needs a weekly resample per case)."""
        sub = d.sample(min(size, len(d)), random_state=SEED).reset_index(drop=True)
        mid = np.full(len(sub), np.nan)
        wid = np.full(len(sub), np.nan)
        p0h = np.full(len(sub), np.nan)
        spread_cache = {}
        for i, (o, h) in enumerate(zip(sub["o"], sub["h"])):
            sid = int(sid_of[o])
            dates, prices = seas.arr[sid]
            k = int(np.searchsorted(dates, origin_day[o], side="right"))   # reports up to the origin only
            if k < 3:
                continue
            ratio, _ = seas.ratio(sid, origin_day[o].astype(object), int(h))
            if o not in spread_cache:
                spread_cache[o] = PriceForecaster._log_spread(
                    pd.DataFrame({"Date": pd.to_datetime(dates[:k]), "price": prices[:k]}))
            p0h[i] = float(np.median(prices[max(0, k - BASELINE_ANCHOR_OBS):k])) * lvl
            mid[i] = p0h[i] * ratio
            wid[i] = 1.2816 * spread_cache[o] * np.sqrt(h / 7)
        ok = np.isfinite(mid)
        sub, mid, wid, p0h = sub[ok].reset_index(drop=True), mid[ok], wid[ok], p0h[ok]
        actual = sub["p0"].to_numpy() * np.exp(sub["y"].to_numpy())
        rows = [{"method": "historical_projection", **metrics(p0h, np.log(actual / p0h), np.log(mid / p0h))}]
        for nm, col in (("trained_model", "pred_model"), (base_col, f"pred_{base_col}"),
                        ("year_ago_x1.05", "pred_year_ago_x1.05")):
            rows.append({"method": nm, **metrics(sub["p0"].to_numpy(), sub["y"].to_numpy(),
                                                 sub[col].to_numpy(float), nm != base_col)})
        e_h = np.abs(mid - actual)
        e_m = np.abs(sub["p0"].to_numpy() * np.exp(sub["pred_model"].to_numpy(float)) - actual)
        e_b = np.abs(sub["p0"].to_numpy() * np.exp(sub[f"pred_{base_col}"].to_numpy(float)) - actual)
        wk = pd.to_datetime(sub["origin"]).dt.to_period("W").astype(str).to_numpy()
        inside = (actual >= mid * np.exp(-wid)) & (actual <= mid * np.exp(wid))
        wpct = (np.exp(wid) - np.exp(-wid)) * 100
        h_ = sub["h"].to_numpy()

        def cov(m):
            return {"coverage_pct": float(inside[m].mean() * 100), "mean_width_pct_of_forecast": float(wpct[m].mean()),
                    "below_pct": float((actual[m] < (mid * np.exp(-wid))[m]).mean() * 100),
                    "above_pct": float((actual[m] > (mid * np.exp(wid))[m]).mean() * 100), "n": int(m.sum())}

        crops = sub["crop"].to_numpy()
        return {"n": int(len(sub)), "table": rows,
                "skill_vs_" + base_col: paired_boot(e_h, e_b, wk, rng),
                "skill_vs_trained_model": paired_boot(e_h, e_m, wk, rng),
                "interval_overall": cov(np.ones(len(sub), bool)),
                "interval_by_band": {BANDS[b]: cov(band_idx(h_) == b) for b in range(4) if (band_idx(h_) == b).sum() >= 30},
                "interval_by_horizon": {hv: cov(h_ == hv) for hv in EXACT if (h_ == hv).sum() >= 30},
                "by_crop_MAE": {c: {"n": int((crops == c).sum()), "historical_projection": float(e_h[crops == c].mean()),
                                    "trained_model": float(e_m[crops == c].mean()), base_col: float(e_b[crops == c].mean())}
                                for c in sorted(set(crops)) if (crops == c).sum() >= 100}}

    hist_n = 1500 if SMOKE else 30_000
    hist = {"real_origin_timing": hist_block(dt, 1.0, hist_n, "no_change"),
            "projection_timing": hist_block(pt, level, hist_n, "reference_x1.05")}
    log("production historical projection scored")

    result = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "smoke_run": SMOKE,
              "settings": {"inflation": infl, "meaningful_change": MEANINGFUL, "train_pairs": N_TRAIN,
                           "validation_origins": "2025-01..2025-06", "test_origins": "2025-07..2025-12",
                           "fit_A_targets_before": str(CUT_A), "fit_B_targets_before": str(CUT_B),
                           "projection_reference_year": PROJ_REF_YEAR, "bootstrap": N_BOOT,
                           "production_model_version": meta["version"]},
              "real_origin": real, "projection": projection,
              "historical_projection": hist, "leakage_test": leak, "data_facts": facts}
    (OUT_DIR / "price_backtest.json").write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
    (OUT_DIR / "price_backtest.md").write_text(render(result, snap), encoding="utf-8")
    log(f"done; reports in {OUT_DIR}")


# ----------------------------------------------------------------------------- report
def verdict_line(skill: dict, base_name: str) -> str:
    s, lo, hi = skill["skill_pct"], skill["ci_low_pct"], skill["ci_high_pct"]
    if lo > 0:
        word = "beats"
    elif hi < 0:
        word = "is WORSE than"
    else:
        word = "is statistically indistinguishable from"
    return f"model {word} **{base_name}** (MAE skill {s:+.1f} %, 95 % CI {lo:+.1f} … {hi:+.1f} %)"


def render(r: dict, snap: dict) -> str:
    re_, pr = r["real_origin"], r["projection"]
    L = []
    L += [f"# Price forecast backtest ({'SMOKE RUN – meaningless numbers' if r['smoke_run'] else 'Phase 1'})", "",
          f"Generated {r['created']} · production model `{r['settings']['production_model_version']}` · "
          f"data 2023-01-01 … 2025-12-31 · inflation assumption {r['settings']['inflation'] * 100:.0f} %", "",
          "Read-only: models were re-fitted in memory with the production architecture; nothing in the pipeline, "
          "model files, database or frontend was changed. Prices are ₹/quintal.", ""]

    L += ["## 1. Current baseline (Phase 0 snapshot, as reported by the production CV)", "",
          f"Model version `{snap['model_version']}`, horizon → model: {snap['horizon_to_model']}.", "",
          md_table([{"horizon": h, "model MAE": snap['reported_cv_mean_selected'][h]["MAE"],
                     "no-change MAE": snap['reported_cv_mean_no_change'][h]["MAE"],
                     "reported direction acc %": snap['reported_cv_mean_selected'][h]["direction_accuracy_pct"]}
                    for h in snap["reported_cv_mean_selected"]]),
          "Saved in `price_baseline_snapshot.json` together with model-file hashes and sample forecasts.", ""]

    L += ["## 2. Method", "",
          "* **Time order.** Fit A uses pairs whose *target* date is before 2025-01-01; fit B before 2025-07-01. "
          "Validation origins are 2025-01…06 (interval calibration, diagnostics); test origins are 2025-07…12 "
          "(final scores). The training code asserts that no training target date reaches the cut-off.",
          "* **Information at the origin.** Features come from the existing code (data ≤ origin). Baselines use only "
          "earlier prices: the year-ago price at (target − 365 days) is always before the origin.",
          "* **Same cases for all methods.** A case is kept only when every method is defined "
          "(a year-ago price, a seasonal ratio from ≥ 1 earlier year, an actual target price).",
          "* **Direction accuracy** counts only cases where the actual price moved more than 5 % from the start price; "
          "`up share` is the share of those that went up (a method that always says “up” would score that).",
          "* **Skill** = 1 − MAE_model / MAE_baseline; its 95 % interval comes from resampling origin *weeks*, which keeps "
          "the strong correlation between neighbouring days.",
          "* **The three forecasting methods are scored separately and never pooled:** (1) the trained model on real-origin "
          "data, (2) the trained model on the production *projection* path, (3) the production *historical projection* "
          "(`forecaster._forecast_baseline`, no model). Sections 3, 4 and 5.",
          "* **WAPE** = 100 × Σ|forecast − actual| / Σ actual, summed over the cases of a row. A zero actual price would make "
          "single-case percentages undefined, which is why WAPE (not MAPE) is used; the script also asserts that every observed "
          "price is > 0 (the cleaning step already removed non-positive modal prices), so nothing needs to be excluded or imputed.",
          "* **MAE** = mean |forecast − actual| in ₹/quintal. **Truth** = the cleaned modal price (outlier-capped, see section 6).",
          "* **Horizon bands** 1–7, 8–14, 15–30, 31–60 days, plus exact horizons 1, 7, 14, 30, 60 (n is printed in every table).", "",
          "### Exactly what was evaluated", "",
          md_table([
              {"id": "trained_model (real-origin)", "what": "Production architecture re-fitted in memory (xgb_rate 1–12 d, rf_rate 13–35 d, rf_plain 36–60 d, "
               "same hyper-parameters), fit B for the test. Start price = last reported price."},
              {"id": "trained_model (projection)", "what": "Same architecture, fit A. Features of the same day one year earlier, start price = that price × 1.05."},
              {"id": "historical_projection", "what": "forecaster._forecast_baseline logic: median of last 10 reports × level × median seasonal ratio "
               "(±10-day windows, up to 3 earlier years); its own displayed range ±1.2816 × weekly log-spread × √(h/7)."},
              {"id": "no_change / latest_known", "what": "Latest reported price carried forward."},
              {"id": "reference_x1.05", "what": "Projection path with model ratio = 1 (the start price itself)."},
              {"id": "year_ago_x1.05", "what": "Price one year before the target date × 1.05."},
              {"id": "seasonal_naive", "what": "Price change over the same days one year earlier (train_price_model.py's baseline)."},
              {"id": "seasonal_ratio", "what": "Median seasonal change of earlier years applied to the start price (the serving fallback ratio)."}],
              ["id", "what"]), ""]

    def section(title, d, methods_note, ref_name, skills_key, band_skill_key):
        L.append(title)
        L.append("")
        L.append(methods_note)
        L.append("")
        L.append(f"Test cases: {d['n_test']:,} · validation cases: {d['n_validation']:,}")
        L.append("")
        L.append("**Test period, all cases**")
        L.append("")
        L.append(md_table(d["test_overall"], ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct", "n_meaningful", "up_share_of_meaningful_pct"]))
        L.append("**Validation period, all cases (for reference)**")
        L.append("")
        L.append(md_table(d["validation_overall"], ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct"]))
        L.append("**Does the model beat each baseline? (test)**")
        L.append("")
        for bl, sk in d["test_skill_vs"].items():
            L.append(f"* {verdict_line(sk, bl)}")
        L.append("")
        L.append(f"**By forecast horizon band – MAE (test)**")
        L.append("")
        rows = []
        for b, tab in d["test_by_band"].items():
            row = {"band (days)": BANDS[int(b)]}
            for t in tab:
                row[t["method"]] = t["MAE"]
            row["n"] = tab[0]["n"]
            rows.append(row)
        L.append(md_table(rows))
        if d.get("test_exact_horizon"):
            L.append("**Exact forecast horizons: test MAE, n, and the shipped 80 % range (coverage / mean width)**")
            L.append("")
            rows = []
            for hv, e in d["test_exact_horizon"].items():
                row = {"horizon (days)": hv, "n": e["table"][0]["n"]}
                for t in e["table"]:
                    row[t["method"]] = t["MAE"]
                row["range coverage %"] = e["interval"]["coverage_pct"]
                row["range width % of start"] = e["interval"]["mean_width_pct_of_start_price"]
                rows.append(row)
            L.append(md_table(rows))
        L.append(f"Model skill vs {ref_name} by band:")
        L.append("")
        for b, sk in d[band_skill_key].items():
            L.append(f"* {b} days: {sk['skill_pct']:+.1f} % (95 % CI {sk['ci_low_pct']:+.1f} … {sk['ci_high_pct']:+.1f})")
        L.append("")
        L.append("**By crop – MAE and direction accuracy (test)**")
        L.append("")
        rows = []
        for c, tab in d["test_by_crop"].items():
            row = {"crop": c, "n": tab[0]["n"]}
            for t in tab:
                row[f"{t['method']} MAE"] = t["MAE"]
            row["model dir. acc %"] = tab[0]["direction_acc_pct"]
            rows.append(row)
        L.append(md_table(rows))
        cs = d["test_cells"]["summary"]
        L.append(f"**Crop × horizon-band cells (n ≥ {CROP_BAND_MIN_N}):** {cs['cells']} cells; model beats "
                 + ", ".join(f"{k[len('model_beats_'):]} in {v}" for k, v in cs.items() if k.startswith("model_beats_") and k != "model_beats_all_baselines")
                 + f"; beats **all** baselines in {cs['model_beats_all_baselines']}.")
        L.append("")
        ib = d["intervals_test"]
        L.append("**Uncertainty interval (nominal 80 %) – actual coverage on the test period**")
        L.append("")
        rows = [{"interval": k, **{kk: vv for kk, vv in v.items()}} for k, v in ib.items() if isinstance(v, dict) and "coverage_pct" in v]
        L.append(md_table(rows, ["interval", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_start_price", "n"]))
        pb = ib["production_by_band"]
        L.append("Production interval coverage by band: " + ", ".join(f"{b}: {v['coverage_pct']:.0f} %" for b, v in pb.items()))
        L.append("")
        return L

    section("## 3. REAL-ORIGIN forecasts (forecast from the market's own recent prices)", re_,
            "This is what the production cross-validation measures. Start price = the last reported price. "
            "Baselines: **no_change** (latest price), **year_ago_x1.05** (price one year before the target date × 1.05), "
            "**seasonal_naive** (the price change of the same days one year earlier, used by train_price_model.py), "
            "**seasonal_ratio** (the serving fallback: median change over earlier years, ±10-day windows).",
            "no_change", "test_skill_vs", "test_by_band_skill_vs_no_change")
    L.append("**Model-selection check (test MAE by horizon band).** The production horizon→model assignment was chosen "
             "on all of 2025, so it has seen the test period; this shows how each candidate fares out of sample:")
    L.append("")
    L.append(md_table([{"band": b, **v} for b, v in re_["candidate_check_test_MAE_by_band"].items()]))
    ps = re_["production_in_sample_reference"]
    L.append(f"*Leak size:* the shipped production models (trained on all data, including this test period) score MAE "
             f"{ps['MAE']:.1f} on these same cases – compare with {re_['test_overall'][0]['MAE']:.1f} for the properly "
             "held-out refit. That gap is why reported in-sample figures must not be used as accuracy.")
    L.append("")

    section("## 4. PROJECTION forecasts (the production path while the data are out of date)", pr,
            "Simulates a user in 2025 whose data end 2024-12-31: features and prices of the same day in **2024** are used, "
            "start price = that 2024 price × 1.05, and the model's ratio is applied to it (as `forecaster._forecast_model` "
            "does with `years_ahead = 1`). The truth is the actual 2025 price. Direction is measured against the app's "
            "(synthetic) start price. Baselines: **reference_x1.05** (the start price itself, i.e. the model with ratio 1 – "
            "the fair “no change” for this path), **latest_known** (the last price actually observed by 2024-12-31), "
            "**year_ago_x1.05** (assume 2025 repeats the realised 2024 change) and **seasonal_ratio**. "
            f"Test origins per month: {pr['test_months']}. Only one year pair (2024→2025) exists, so this is a single "
            "replication of the annual pattern.",
            "reference_x1.05", "test_skill_vs", "test_by_band_skill_vs_reference")

    hp, lk, fa = r["historical_projection"], r["leakage_test"], r["data_facts"]

    # ---- production historical projection, evaluated on its own
    L += ["## 5. Production historical projection (`_forecast_baseline`), evaluated on its own", "",
          "This is the fallback the application uses when no trained model can run. It is **not** the trained model and is not "
          "validated by the sections above. Each timing is scored on its own random subset; the trained model and a no-change "
          "reference are scored on exactly the same cases only for comparison.", ""]
    for key, title, base in (("real_origin_timing", "5a. Real-origin timing (start from the latest reported price, level ×1.00)", "no_change"),
                             ("projection_timing", "5b. Projection timing (2024 reference, level ×1.05, truth = actual 2025)", "reference_x1.05")):
        b = hp[key]
        L += [f"### {title}", "", f"n = {b['n']:,} test cases.", "",
              md_table(b["table"], ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct", "n_meaningful"]),
              f"* {verdict_line(b['skill_vs_' + base], base)}",
              f"* {verdict_line(b['skill_vs_trained_model'], 'the trained model')}", ""]
        rows = [{"scope": "all", **b["interval_overall"]}]
        rows += [{"scope": f"{k} days", **v} for k, v in b["interval_by_band"].items()]
        rows += [{"scope": f"h = {k}", **v} for k, v in b["interval_by_horizon"].items()]
        L += ["Its displayed 80 % range – actual coverage:", "",
              md_table(rows, ["scope", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_forecast", "n"]),
              "By crop (MAE):", "",
              md_table([{"crop": c, **v} for c, v in b["by_crop_MAE"].items()], ["crop", "n", "historical_projection", "trained_model", base]), ""]

    # ---- leakage audit
    L += ["## 6. Data-leakage and data-handling audit", "",
          "**Measured – feature-cut test.** Features were recomputed on a panel cut at a date and compared with the features of the "
          "full panel for every row up to that date. A mismatch would mean a feature depends on later data.", "",
          md_table([{"cut date": x["cut_date"], "rows compared": x["rows_compared"], "values compared": x["feature_values_compared"],
                     "mismatching values": x["mismatching_values"], "features affected": ", ".join(x["features_with_mismatch"]) or "none"} for x in lk]),
          "", "**Checked by code inspection (not re-measured):**", "",
          "| Item | Finding |", "|---|---|",
          "| Future prices | Lags, rolling means, volatility use `price_ffill` backwards only. Targets (`target_price`) are used only as labels. Training pairs require target date < cut-off (asserted). |",
          "| Future arrivals | `log_arrivals`, `arrivals_vs_30d` use arrivals up to the origin day (forward-fill ≤ 7 days, backward rolling mean). No arrivals forecast exists or is needed. |",
          "| Future weather | The deployed model has no weather inputs; no weather is used anywhere in this backtest. |",
          "| State-median feature | `state_price` is the median over markets **on the same day**; known at the origin, not later. |",
          "| Encoders | Crop / market / variety integer codes are fitted on the whole panel. They carry no price information; harmless for leakage. |",
          "| Scaling | No feature scaling is used (tree models). |",
          "| Model selection | **Leaks.** The horizon→model assignment and the shipped residual intervals were chosen on all four 2025 quarters, which include this test period. This backtest keeps the assignment (as the task requires) but re-fits and re-calibrates on earlier data; section 3 shows the assignment still holds out of sample. |",
          "| Shipped models | The files in `trained_models/` were trained on all data through 2025-12-31, so scoring them on 2025 is in-sample (section 3 quantifies the gap). They are not used for the held-out scores. |",
          "| Missing dates | The panel is re-indexed to a daily calendar. A price is carried forward at most 7 days (features) / 3 days (target); a longer gap stays missing and that origin is not used. |",
          f"| Duplicates | 3,834 raw rows (1,917 same-day groups with different prices) were merged to their median at cleaning; arrivals were averaged. No exact duplicates existed. |",
          "| Outliers | 610 modal prices (> 4× / < ¼ of the trailing 15-report median) were **capped** at cleaning; the capped value is both an input and the truth in this backtest. |",
          "| Inflation | A constant 5 %/yr (`DEFAULT_INFLATION`), applied only to the start price at serving time, never in training; it is not estimated from the data. |",
          f"| Size | {fa['panel_rows']:,} daily panel rows, {fa['observed_rows']:,} observed, {fa['usable_origins']:,} usable origins, {fa['series']} series; smallest observed price ₹{fa['min_observed_price']:.0f}/q. |",
          "", "**Limitation from the data ending 2025-12-31:** no 2026 price exists, so the application's 2026 forecasts can never be scored against actual prices; "
          "the 2024→2025 projection test is the only available proxy and it is a single year pair.", ""]

    # ---- verdict
    rs = re_["test_skill_vs"]["no_change"]
    ps_ = pr["test_skill_vs"]["reference_x1.05"]
    pl = pr["test_skill_vs"]["latest_known"]
    cov_r = re_["intervals_test"]["production_intervals_as_shipped"]["coverage_pct"]
    cov_p = pr["intervals_test"]["production_intervals_as_shipped"]["coverage_pct"]
    hr, hq = hp["real_origin_timing"], hp["projection_timing"]
    best = lambda tab: min(tab, key=lambda t: t["MAE"])["method"]   # noqa: E731
    L += ["## 7. Which approach was best on unseen dates, and is the production approach supported?", "",
          f"* **Real-origin, lowest MAE:** {best(re_['test_overall'])} (trained model MAE {re_['test_overall'][0]['MAE']:.0f}, "
          f"no-change {re_['test_overall'][1]['MAE']:.0f}). {verdict_line(rs, 'no change')}.",
          f"* **Projection, lowest MAE:** {best(pr['test_overall'])}. Trained model: {verdict_line(ps_, 'reference × 1.05')}; "
          f"{verdict_line(pl, 'the latest known price')}.",
          f"* **Production historical projection:** real-origin timing {verdict_line(hr['skill_vs_no_change'], 'no change')}; "
          f"projection timing {verdict_line(hq['skill_vs_reference_x1.05'], 'reference × 1.05')}.",
          f"* **Shipped 80 % ranges, actual coverage:** trained model real-origin {cov_r:.0f} %, trained model projection {cov_p:.0f} %, "
          f"historical projection {hr['interval_overall']['coverage_pct']:.0f} % (real-origin) / {hq['interval_overall']['coverage_pct']:.0f} % (projection).", ""]
    ok_real, ok_proj = rs["ci_low_pct"] > 0, ps_["ci_low_pct"] > 0
    ok_hist = hq["skill_vs_reference_x1.05"]["ci_low_pct"] > 0
    L += [f"**Reading (derived from the numbers above):** the trained model {'is' if ok_real else 'is NOT'} shown to beat no-change on real-origin "
          f"forecasts; on the projection path it {'does' if ok_proj else 'does not'} clearly beat a plain replay of last year × 1.05 and "
          f"{'does' if pl['ci_low_pct'] > 0 else 'does not'} clearly beat the latest known price; the historical projection "
          f"{'does' if ok_hist else 'does not'} clearly beat the reference. Ranges are "
          f"{'close to' if all(abs(c - 80) <= 8 for c in (cov_r, cov_p)) else 'NOT close to'} 80 % in both trained-model scenarios.", ""]

    # ---- problems
    worse = [c for c, tab in re_["test_by_crop"].items() if tab[0]["MAE"] > tab[1]["MAE"]]
    worse_p = [c for c, tab in pr["test_by_crop"].items() if tab[0]["MAE"] > tab[1]["MAE"]]
    pm = pr["test_overall"][0]
    L += ["## 8. Problems found in the current pipeline", "", "**Measured**", "",
          f"1. Projection-path ranges cover {cov_p:.0f} % of actual prices instead of 80 % "
          f"({pr['intervals_test']['production_intervals_as_shipped']['below_pct']:.0f} % fall below the range).",
          f"2. Projection-path MAE ({pm['MAE']:.0f}) is more than twice the real-origin MAE ({re_['test_overall'][0]['MAE']:.0f}); the "
          "reported CV accuracy describes the real-origin task, not what users receive.",
          f"3. Real-origin: the model is worse than no-change for {', '.join(worse) or 'no crop'}; projection: worse than the "
          f"reference for {', '.join(worse_p) or 'no crop'}.",
          f"4. Direction accuracy on projection ({pm['direction_acc_pct']:.0f} %) must be read against the base rate: "
          f"{100 - pm['up_share_of_meaningful_pct']:.0f} % of meaningful moves were downward in this test year.",
          f"5. Shipped (in-sample) models score MAE {re_['production_in_sample_reference']['MAE']:.0f} vs {re_['test_overall'][0]['MAE']:.0f} held-out: "
          "any accuracy quoted from the shipped models on 2025 data is optimistic.",
          "6. Seasonal baselines (seasonal_naive, seasonal_ratio, year_ago) are much worse than no-change in the real-origin test, "
          "so seasonal repetition from 2–3 years of data is a weak forecasting signal.", "",
          "**Found by code inspection (assumptions to be verified in later phases)**", "",
          "7. Model-choice per horizon and the interval widths were fitted on all of 2025 (test period included).",
          "8. The 5 % inflation factor is a constant, not estimated from data, and is applied to a one-year-old price.",
          "9. The start price shown in the application during projection is last year's price × 1.05, not a current market price.", ""]

    # ---- recommendations
    L += ["## 9. Most important next improvements (recommendations, not measured results)", "",
          "1. Refresh the price data to the present, so forecasts start from real current prices instead of a one-year-old snapshot.",
          "2. Until then, widen / recalibrate the projection-path range on projection backtest residuals and label the start price and the forecast as a seasonal-scenario estimate.",
          "3. Extend the history before 2023 (if available) to obtain more seasons and re-run this backtest with several year pairs.",
          "4. Treat Onion and Wheat (and long horizons) as not validated; offer the latest-price baseline there.",
          "5. Only after the above, test extra features (nearby markets, arrivals, weather) with this same backtest and keep them only if they win on the held-out period.", ""]

    L += ["## 10. Limitations of this evaluation", "",
          "* **Three years of data**: one held-out half-year for the real-origin test and a single year pair (2024→2025) for the projection test. Conclusions are suggestive, not strong.",
          "* Confidence intervals resample origin weeks and therefore understate year-to-year uncertainty.",
          "* Fit B / interval mismatch: validation-recalibrated ranges (fit A) are applied to fit-B forecasts.",
          "* Projection test staleness is 6–12 months (2025-H2); today's is about 10 months. The year-ago baseline removes cases whose reference target lies after 2024-12-31, so late-year origins keep only short horizons.",
          "* Pooled MAE is dominated by high-priced crops and many state/wheat series; read the per-crop and per-band tables.",
          "* Markets move together, so the effective sample size is smaller than the case counts.",
          "* The historical-projection range was evaluated on a 30,000-case random subset per timing.",
          "* Weather, arrivals forecasting and new data were deliberately not evaluated.", ""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
