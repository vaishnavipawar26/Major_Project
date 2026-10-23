"""Phase 2: evidence features + shrunk, conformal-calibrated candidate model, backtested like Phase 1.

Run from backend/:   python -m scripts.backtest_candidate_v2      (EVAL_SMOKE=1 = tiny code-path check)

Nothing in the production pipeline, models, database or frontend is touched. Output:
  dataset/reports/price_candidate_v2.md / .json      comparison report
  dataset/reports/explanation_samples.md / .json     6 sample explanations
  backend/trained_models/candidate_v2/               evaluation fits + calibration (NEW path, never production)

Splits are those of Phase 1 (scripts/backtest_price.py):
  fit A  pairs with target date < 2025-01-01  -> validation (origins 2025-01..06): shrinkage weights,
         conformal intervals, projection-anchor choice (validation ONLY)
  fit B  pairs with target date < 2025-07-01  -> test (origins 2025-07..12), real-origin
  projection test: fit A, reference year 2024 -> actual 2025 (as in Phase 1)
Both the production feature set (v1, re-fitted) and the v2 feature set are fitted on exactly the same
training pairs, so any difference is due to the features, the shrinkage or the intervals.
"""
from __future__ import annotations

import json
import os
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.common import paths
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, MODEL_FEATURES, SERIES_KEY,
                                              compute_features, target_log_change,
                                              usable_origin_mask, with_pair_features)
from app.ml.price_prediction.forecaster import _load_inflation
from app.ml.price_v2.explain_v2 import GROUPS, TITLES, band_of, explain_forecast
from app.ml.price_v2.features_v2 import (EVIDENCE_ROW_FEATURES, V2_FEATURES, add_evidence_features,
                                         add_pair_evidence, season_table, year_index)
from scripts.backtest_price import (BANDS, SeasonalRatio, band_idx, clean, md_table, metrics,
                                    paired_boot, production_interval)
from scripts.train_price_model import fit, predict, sample

warnings.filterwarnings("ignore", category=RuntimeWarning)
SMOKE = os.getenv("EVAL_SMOKE") == "1"
OUT_DIR = Path(os.getenv("EVAL_OUT_DIR", paths.REPORTS_DIR))
MODEL_DIR = (OUT_DIR / "candidate_v2") if SMOKE else paths.MODELS_DIR / "candidate_v2"
N_TRAIN = 20_000 if SMOKE else 400_000
N_VAL = 4_000 if SMOKE else 150_000
N_TEST = 4_000 if SMOKE else 150_000
N_PROJ = 4_000 if SMOKE else 100_000
N_BOOT = 100 if SMOKE else 1000
SEED = 7
CUT_A, CUT_B = np.datetime64("2025-01-01"), np.datetime64("2025-07-01")
VAL_START, VAL_END = np.datetime64("2025-01-01"), np.datetime64("2025-06-30")
TEST_START, TEST_END = np.datetime64("2025-07-01"), np.datetime64("2025-12-31")
PROJ_REF_YEAR, PROJ_DATA_END = 2024, np.datetime64("2024-12-31")
W_GRID = np.round(np.arange(0, 1.0001, 0.1), 2)
ALPHA = 0.20                       # 80 % intervals
MIN_CELL = 200                     # a crop x band cell needs this many validation cases of its own
EXACT = (1, 7, 14, 30, 60)
PHASE1_JSON = paths.REPORTS_DIR / "price_backtest.json"


# ----------------------------------------------------------------------------- calibration helpers
def choose_w(crop, band, anchor, yhat, actual, n_crops):
    """Shrinkage weight per crop x band: argmin of validation MAE of anchor*exp(w*yhat); band-pooled
    weight when a cell has fewer than MIN_CELL cases. Returns W[crop, band] (every entry filled)."""
    errs = np.stack([np.abs(anchor * np.exp(w * yhat) - actual) for w in W_GRID])

    def best(sel):
        return float(W_GRID[int(np.argmin(errs[:, sel].mean(axis=1)))])

    W = np.ones((n_crops, 4))
    for b in range(4):
        pooled = best(band == b) if (band == b).any() else 1.0
        W[:, b] = pooled
        for c in range(n_crops):
            sel = (crop == c) & (band == b)
            if sel.sum() >= MIN_CELL:
                W[c, b] = best(sel)
    return W


def conformal_q(crop, band, resid, n_crops):
    """Split-conformal asymmetric 80 % band for the log residual y - pred, per crop x band."""
    def q(r):
        r = np.sort(r)
        n = len(r)
        lo = r[max(int(np.floor((n + 1) * ALPHA / 2)) - 1, 0)]
        hi = r[min(int(np.ceil((n + 1) * (1 - ALPHA / 2))) - 1, n - 1)]
        return float(lo), float(hi)

    Q = np.zeros((n_crops, 4, 2))
    for b in range(4):
        pooled = q(resid[band == b]) if (band == b).sum() > 20 else (-0.3, 0.3)
        Q[:, b] = pooled
        for c in range(n_crops):
            sel = (crop == c) & (band == b)
            if sel.sum() >= MIN_CELL:
                Q[c, b] = q(resid[sel])
    return Q


def typical_error(crop, band, resid, n_crops):
    T = np.zeros((n_crops, 4))
    for b in range(4):
        T[:, b] = np.median(np.abs(resid[band == b])) if (band == b).any() else 0.1
        for c in range(n_crops):
            sel = (crop == c) & (band == b)
            if sel.sum() >= MIN_CELL:
                T[c, b] = np.median(np.abs(resid[sel]))
    return T


def cov_block(y, pred, lo, hi, m=None):
    m = np.ones(len(y), bool) if m is None else m
    a, b = pred[m] + lo[m], pred[m] + hi[m]
    return {"coverage_pct": float(((y[m] >= a) & (y[m] <= b)).mean() * 100),
            "below_pct": float((y[m] < a).mean() * 100), "above_pct": float((y[m] > b).mean() * 100),
            "mean_width_pct_of_start": float((np.exp(b) - np.exp(a)).mean() * 100), "n": int(m.sum())}


def dir_block(y, pred, clear):
    mv = np.abs(np.expm1(y)) > 0.05
    called = mv & (pred != 0)
    cl = mv & clear
    return {"direction_acc_all_calls_pct": float((np.sign(pred[called]) == np.sign(y[called])).mean() * 100) if called.any() else np.nan,
            "direction_acc_clear_calls_pct": float((np.sign(pred[cl]) == np.sign(y[cl])).mean() * 100) if cl.any() else np.nan,
            "clear_call_rate_pct": float(clear.mean() * 100), "n_meaningful": int(mv.sum())}


def row(name, p0, y, pred, dirs=True, extra=None):
    return {"method": name, **metrics(p0, y, pred, dirs), **(extra or {})}


# ----------------------------------------------------------------------------- leakage assertions
def row_feature_leak_test(panel, encoders, ev_full, cuts=("2024-06-30", "2025-03-31")) -> list[dict]:
    """Recompute the v2 row features on a panel cut at a date; they must equal the full-panel values
    for every row up to that date (a difference would mean a feature reads later data)."""
    key = [*SERIES_KEY, "Date"]
    ref = ev_full.set_index(key)[EVIDENCE_ROW_FEATURES]
    out = []
    for cut in cuts:
        sub = panel[panel["Date"] <= pd.Timestamp(cut)]
        f2 = add_evidence_features(compute_features(sub, encoders, with_targets=False)).set_index(key)[EVIDENCE_ROW_FEATURES]
        a, b = ref.reindex(f2.index).to_numpy(float), f2.to_numpy(float)
        same = (np.isnan(a) & np.isnan(b)) | (np.abs(a - b) < 1e-6)
        for i, f in enumerate(EVIDENCE_ROW_FEATURES):
            out.append({"feature": f, "cut": cut, "values_compared": int(a.shape[0]), "mismatches": int((~same[:, i]).sum()),
                        "non_missing_share_pct": float(np.isfinite(b[:, i]).mean() * 100)})
    return out


def season_leak_test(crop_code, year, month, origin_day, Y, S, n_crops, rng) -> list[dict]:
    """season_change for year Y must not depend on any origin/target in year >= Y: scramble those
    labels and require an identical table row. Also: the first data year has no value."""
    out = []
    for y_idx in (1, 2):
        Yp = Y.copy()
        rows = year >= 2023 + y_idx
        Yp[rows] = rng.normal(0, 0.3, size=Yp[rows].shape).astype("float32")
        S2, _ = season_table(crop_code, year, month, origin_day, Yp, n_crops)
        out.append({"feature": "season_change", "check": f"scramble every label from {2023 + y_idx} onward; table for {2023 + y_idx} unchanged",
                    "passed": bool(np.array_equal(S2[:, y_idx], S[:, y_idx], equal_nan=True))})
    out.append({"feature": "season_change", "check": "year 2023 has no earlier year -> all missing", "passed": bool(np.isnan(S[:, 0]).all())})
    return out


# ----------------------------------------------------------------------------- main
def main() -> None:
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    log = lambda s: print(f"[{time.time() - t0:5.0f}s] {s}", flush=True)   # noqa: E731

    meta = json.loads((paths.PRICE_MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
    prep = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")
    assert list(prep["feature_columns"]) == list(MODEL_FEATURES)
    encoders = prep["encoders"]
    crops = sorted(encoders["commodity"], key=encoders["commodity"].get)
    n_crops = max(encoders["commodity"].values()) + 1
    level = 1 + _load_inflation()
    horizon_model = {int(h): c for h, c in meta["horizon_models"].items()}
    cand_of_h = np.array([horizon_model.get(h, "") for h in range(0, MAX_HORIZON + 1)])
    needed = sorted(set(horizon_model.values()))

    # ---- data inventory (Step 1)
    clean_df = pd.read_parquet(paths.PRICE_CLEAN_PATH)
    loc = pd.read_csv(paths.CROP_PRICE_DIR / "market_locations.csv")
    cmap = pd.read_csv(paths.CROP_REC_DIR / "city_market_map.csv")
    inv = {"raw_columns": list(pd.read_csv(paths.RAW_DIR / "Maharashtra_Crop_Prices_2023_2025_Cleaned.csv", nrows=0).columns),
           "arrivals_by_crop": [{"crop": c, "rows": int(len(g)), "markets": int(g["Market"].nunique()),
                                 "arrivals_missing_pct": float(g["Arrivals"].isna().mean() * 100),
                                 "arrivals_zero_pct": float((g["Arrivals"] == 0).mean() * 100),
                                 "median_arrivals": float(g["Arrivals"].median()),
                                 "median_reporting_days_per_market": float(g.groupby("Market").size().median())}
                                for c, g in clean_df.groupby("Commodity")],
           "total_days": int((clean_df["Date"].max() - clean_df["Date"].min()).days + 1),
           "market_location_status": loc["status"].value_counts().to_dict(),
           "location_has_district_column": bool("district" in [c.lower() for c in loc.columns]),
           "city_market_map": {"rows": int(len(cmap)), "cities": int(cmap["city"].nunique()), "markets": int(cmap["market"].nunique())},
           "arrivals_unit_in_file": "not stated"}

    # ---- features
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    feat = compute_features(panel, encoders, with_targets=True)
    mask = usable_origin_mask(feat).to_numpy()                      # identical origins to production
    ev = add_evidence_features(feat)
    ev["sid"] = ev.groupby(SERIES_KEY, sort=False).ngroup()
    base = ev[mask].reset_index(drop=True)
    n, H = len(base), MAX_HORIZON
    log(f"usable origins {n:,}")
    g = ev.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365).to_numpy()[mask]
    Y = np.empty((n, H), "float32")
    SN = np.empty((n, H), "float32")
    YA = np.empty((n, H), "float32")
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(ev, h).to_numpy()[mask]
        lp_t = g.shift(365 - h).to_numpy()[mask]
        YA[:, h - 1], SN[:, h - 1] = lp_t, lp_t - lag365
    oi = np.repeat(np.arange(n, dtype="int32"), H)
    hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    y_all, sn_all, ya_all = Y.ravel(), SN.ravel(), YA.ravel()
    origin_day = base["Date"].to_numpy().astype("datetime64[D]")
    pair_origin = origin_day[oi]
    pair_target = pair_origin + hh.astype("timedelta64[D]")
    has_target = np.isfinite(y_all)
    defined = has_target & np.isfinite(sn_all) & np.isfinite(ya_all)   # same case population as Phase 1
    logp0 = base["log_price"].to_numpy()
    crop_code = base["commodity_code"].to_numpy(int)
    sid_of = base["sid"].to_numpy()
    by_year = base["Date"].dt.year.to_numpy()
    by_month = base["Date"].dt.month.to_numpy()
    seas = SeasonalRatio(feat.assign(sid=ev["sid"]))
    S, Nyears = season_table(crop_code, by_year, by_month, origin_day, Y, n_crops)

    # ---- leakage assertions (Step 2)
    leak_rows = row_feature_leak_test(panel, encoders, ev)
    leak_season = season_leak_test(crop_code, by_year, by_month, origin_day, Y, S, n_crops, np.random.default_rng(3))
    for r_ in leak_rows:
        assert r_["mismatches"] == 0, f"LEAKAGE in {r_['feature']} at cut {r_['cut']}"
    for r_ in leak_season:
        assert r_["passed"], f"LEAKAGE check failed: {r_}"
    log(f"leakage assertions passed ({len(leak_rows)} row-feature cuts, {len(leak_season)} season checks)")

    def X1_of(idx):
        return with_pair_features(base.iloc[oi[idx]], hh[idx])

    def X2_of(idx):
        o = base.iloc[oi[idx]]
        return add_pair_evidence(with_pair_features(o, hh[idx]), o, hh[idx], S)

    def fit_set(cut, label):
        tr = sample(rng, has_target & (pair_target < cut), N_TRAIN)
        assert pair_target[tr].max() < cut, "training target date leaks past the cut-off"
        X1, X2, yy = X1_of(tr), X2_of(tr), y_all[tr]
        m1, m2 = {}, {}
        for c in needed:
            m1[c] = fit(c, X1, yy)
            m2[c] = fit(c, X2, yy)
            log(f"fit {label} {c} (v1, v2): {len(tr):,} pairs, targets < {cut}")
        return m1, m2

    def predict_all(models, X):
        hs = X["horizon_days"].to_numpy().astype(int)
        out = np.empty(len(X), "float32")
        for c in needed:
            r = cand_of_h[hs] == c
            if r.any():
                out[r] = predict(c, models[c], X[r])
        return out

    A1, A2 = fit_set(CUT_A, "A")
    B1, B2 = fit_set(CUT_B, "B")

    # ========================================================================= REAL-ORIGIN
    def real_cases(lo, hi, size, M1, M2):
        idx = sample(rng, defined & (pair_origin >= lo) & (pair_origin <= hi), size)
        o, h = oi[idx], hh[idx].astype(int)
        yrs = np.array([seas.ratio(int(sid_of[a]), origin_day[a].astype(object), int(b))[1] for a, b in zip(o, h)])
        idx, o, h = idx[yrs > 0], o[yrs > 0], h[yrs > 0]
        X1, X2 = X1_of(idx), X2_of(idx)
        return pd.DataFrame({
            "idx": idx, "o": o, "crop": crop_code[o], "h": h, "band": band_idx(h), "origin": origin_day[o],
            "p0": np.exp(logp0[o]), "y": y_all[idx].astype(float), "no_change": 0.0,
            "v1": predict_all(M1, X1).astype(float), "v2": predict_all(M2, X2).astype(float)}), X2

    dv, _ = real_cases(VAL_START, VAL_END, N_VAL, A1, A2)
    dt, Xt2 = real_cases(TEST_START, TEST_END, N_TEST, B1, B2)
    log(f"real cases: validation {len(dv):,}, test {len(dt):,}")

    actual_v = dv["p0"].to_numpy() * np.exp(dv["y"].to_numpy())
    W1 = choose_w(dv["crop"].to_numpy(), dv["band"].to_numpy(), dv["p0"].to_numpy(), dv["v1"].to_numpy(), actual_v, n_crops)
    W2 = choose_w(dv["crop"].to_numpy(), dv["band"].to_numpy(), dv["p0"].to_numpy(), dv["v2"].to_numpy(), actual_v, n_crops)
    for d_ in (dv, dt):
        c_, b_ = d_["crop"].to_numpy(), d_["band"].to_numpy()
        d_["w1"], d_["w2"] = W1[c_, b_], W2[c_, b_]
        d_["v1s"], d_["v2s"] = d_["w1"] * d_["v1"], d_["w2"] * d_["v2"]
    resid_v = dv["y"].to_numpy() - dv["v2s"].to_numpy()
    Q2 = conformal_q(dv["crop"].to_numpy(), dv["band"].to_numpy(), resid_v, n_crops)
    T2 = typical_error(dv["crop"].to_numpy(), dv["band"].to_numpy(), resid_v, n_crops)
    for d_ in (dv, dt):
        c_, b_ = d_["crop"].to_numpy(), d_["band"].to_numpy()
        d_["clo"], d_["chi"] = Q2[c_, b_, 0], Q2[c_, b_, 1]
        d_["terr"] = T2[c_, b_]
        d_["clear"] = (d_["w2"] > 0) & (np.abs(np.expm1(d_["v2s"])) >= np.expm1(d_["terr"]))
    dt["plo"], dt["phi"] = production_interval(meta, dt.assign(h=dt["h"], crop=[crops[i] for i in dt["crop"]]))
    log("shrinkage weights, conformal bands and typical errors fitted on validation")

    P0, Yt = dt["p0"].to_numpy(), dt["y"].to_numpy()
    act_t = P0 * np.exp(Yt)
    week = pd.to_datetime(dt["origin"]).dt.to_period("W").astype(str).to_numpy()
    aerr = lambda col: np.abs(P0 * np.exp(dt[col].to_numpy()) - act_t)   # noqa: E731
    methods = [("no_change", "no_change", False), ("v1_refit (production features)", "v1", True),
               ("v1_shrunk", "v1s", True), ("v2_raw (new features)", "v2", True), ("v2_shrunk (CANDIDATE)", "v2s", True)]

    def table(mask=None):
        m = np.ones(len(dt), bool) if mask is None else mask
        out = []
        for nm, col, dr in methods:
            extra = dir_block(Yt[m], dt[col].to_numpy()[m], dt["clear"].to_numpy()[m]) if col == "v2s" else None
            out.append(row(nm, P0[m], Yt[m], dt[col].to_numpy()[m], dr, extra))
        return out

    real = {"n_validation": len(dv), "n_test": len(dt), "test_overall": table(),
            "test_by_band": {BANDS[b]: table(dt["band"].to_numpy() == b) for b in range(4)},
            "test_by_crop": {crops[c]: table(dt["crop"].to_numpy() == c) for c in sorted(dt["crop"].unique())},
            "test_exact_horizon": {h_: table(dt["h"].to_numpy() == h_) for h_ in EXACT if (dt["h"] == h_).sum() >= 30}}
    real["skill_candidate_vs_no_change"] = paired_boot(aerr("v2s"), aerr("no_change"), week, rng)
    real["skill_raw_v2_vs_no_change"] = paired_boot(aerr("v2"), aerr("no_change"), week, rng)
    real["skill_v1_refit_vs_no_change"] = paired_boot(aerr("v1"), aerr("no_change"), week, rng)
    real["skill_candidate_vs_v1_refit"] = paired_boot(aerr("v2s"), aerr("v1"), week, rng)
    real["skill_candidate_vs_no_change_by_band"] = {BANDS[b]: paired_boot(aerr("v2s")[dt["band"].to_numpy() == b], aerr("no_change")[dt["band"].to_numpy() == b],
                                                                           week[dt["band"].to_numpy() == b], rng) for b in range(4)}
    real["skill_candidate_vs_no_change_by_crop"] = {crops[c]: paired_boot(aerr("v2s")[dt["crop"].to_numpy() == c], aerr("no_change")[dt["crop"].to_numpy() == c],
                                                                           week[dt["crop"].to_numpy() == c], rng) for c in sorted(dt["crop"].unique())}
    cells = []
    for (c, b), gi in dt.groupby(["crop", "band"]):
        if len(gi) >= 100:
            ix = gi.index.to_numpy()
            cells.append({"crop": crops[c], "band": BANDS[b], "n": len(gi), "w": float(W2[c, b]),
                          "MAE_candidate": float(aerr("v2s")[ix].mean()), "MAE_no_change": float(aerr("no_change")[ix].mean()),
                          "MAE_v1_refit": float(aerr("v1")[ix].mean())})
    real["cells"] = cells
    real["intervals"] = {
        "candidate_conformal": cov_block(Yt, dt["v2s"].to_numpy(), dt["clo"].to_numpy(), dt["chi"].to_numpy()),
        "candidate_by_band": {BANDS[b]: cov_block(Yt, dt["v2s"].to_numpy(), dt["clo"].to_numpy(), dt["chi"].to_numpy(), dt["band"].to_numpy() == b) for b in range(4)},
        "candidate_by_crop": {crops[c]: cov_block(Yt, dt["v2s"].to_numpy(), dt["clo"].to_numpy(), dt["chi"].to_numpy(), dt["crop"].to_numpy() == c) for c in sorted(dt["crop"].unique())},
        "candidate_exact_horizon": {h_: cov_block(Yt, dt["v2s"].to_numpy(), dt["clo"].to_numpy(), dt["chi"].to_numpy(), dt["h"].to_numpy() == h_) for h_ in EXACT if (dt["h"] == h_).sum() >= 30},
        "v1_with_shipped_production_intervals": cov_block(Yt, dt["v1"].to_numpy(), dt["plo"].to_numpy(), dt["phi"].to_numpy()),
        "v1_shipped_by_band": {BANDS[b]: cov_block(Yt, dt["v1"].to_numpy(), dt["plo"].to_numpy(), dt["phi"].to_numpy(), dt["band"].to_numpy() == b) for b in range(4)}}
    log("real-origin scored")

    # reliability table used by the explanation text (test period, candidate)
    reliab = {}
    for (c, b), gi in dt.groupby(["crop", "band"]):
        ix = gi.index.to_numpy()
        db = dir_block(Yt[ix], dt["v2s"].to_numpy()[ix], dt["clear"].to_numpy()[ix])
        reliab[f"{crops[c]}|{BANDS[b]}"] = {
            "n": int(len(ix)), "mae": float(aerr("v2s")[ix].mean()), "wape_pct": float(aerr("v2s")[ix].sum() / act_t[ix].sum() * 100),
            "dir_acc_clear_pct": db["direction_acc_clear_calls_pct"], "clear_rate_pct": db["clear_call_rate_pct"],
            "skill_vs_no_change_pct": float((1 - aerr("v2s")[ix].sum() / aerr("no_change")[ix].sum()) * 100),
            "typical_error_log": float(T2[c, b]), "shrink_weight": float(W2[c, b])}

    # ========================================================================= PROJECTION
    ref_rows = np.flatnonzero(by_year == PROJ_REF_YEAR)
    in_ref = np.isin(oi, ref_rows)
    last_known = (feat[feat["observed"] & (feat["Date"] <= pd.Timestamp(PROJ_DATA_END))]
                  .groupby(ev["sid"])["price"].last())
    yoy = np.full(int(ev["sid"].max()) + 1, np.nan)
    for sid_, (d_arr, p_arr) in seas.arr.items():
        a = (d_arr >= np.datetime64("2024-01-01")) & (d_arr <= PROJ_DATA_END)
        b = (d_arr >= np.datetime64("2023-01-01")) & (d_arr <= np.datetime64("2023-12-31"))
        if a.sum() >= 60 and b.sum() >= 60:
            yoy[sid_] = np.clip(np.log(p_arr[a].mean() / p_arr[b].mean()), -0.5, 0.5)
    ok_proj = defined & in_ref & (pair_target <= PROJ_DATA_END)
    tp = feat.assign(sid=ev["sid"]).loc[feat["target_price"].notna(), ["sid", "Date", "target_price"]]

    def proj_cases(m_lo, m_hi, size):
        mo = pd.DatetimeIndex(origin_day[oi]).month.to_numpy()
        idx = sample(rng, ok_proj & (mo >= m_lo) & (mo <= m_hi), int(size * 1.4))
        o, h = oi[idx], hh[idx].astype(int)
        od = pd.DatetimeIndex(origin_day[o])
        d2 = (od + pd.DateOffset(years=1)) + pd.to_timedelta(h, unit="D")
        pairs = pd.DataFrame({"sid": sid_of[o], "Date": d2.to_numpy(), "k": np.arange(len(o))})
        actual = pairs.merge(tp, on=["sid", "Date"], how="left").sort_values("k")["target_price"].to_numpy()
        yrs = np.array([seas.ratio(int(sid_of[a]), origin_day[a].astype(object), int(b))[1] for a, b in zip(o, h)])
        lk = last_known.reindex(sid_of[o]).to_numpy()
        keep = np.isfinite(actual) & (yrs > 0) & np.isfinite(lk)
        idx, o, h, actual, lk = idx[keep], o[keep], h[keep], actual[keep], lk[keep]
        pref = np.exp(logp0[o])
        yo = np.nan_to_num(yoy[sid_of[o]], nan=0.0)
        X1, X2 = X1_of(idx), X2_of(idx)
        return pd.DataFrame({
            "o": o, "crop": crop_code[o], "h": h, "band": band_idx(h), "actual": actual,
            "origin": (od[keep] + pd.DateOffset(years=1)).to_numpy(),
            "a_ref105": pref * level, "a_latest": lk, "a_yoy": pref * np.exp(yo),
            "v1": predict_all(A1, X1).astype(float), "v2": predict_all(A2, X2).astype(float)})

    pv = proj_cases(1, 6, N_PROJ)
    pt = proj_cases(7, 12, N_PROJ)
    log(f"projection cases: validation {len(pv):,}, test {len(pt):,}")
    variants = {"ref_x1.05 (current)": "a_ref105", "latest_known_0pct": "a_latest", "trailing_yoy": "a_yoy"}
    Wp, val_mae = {}, {}
    for nm, col in variants.items():
        Wp[nm] = choose_w(pv["crop"].to_numpy(), pv["band"].to_numpy(), pv[col].to_numpy(), pv["v2"].to_numpy(), pv["actual"].to_numpy(), n_crops)
        w_ = Wp[nm][pv["crop"].to_numpy(), pv["band"].to_numpy()]
        val_mae[nm] = float(np.abs(pv[col].to_numpy() * np.exp(w_ * pv["v2"].to_numpy()) - pv["actual"].to_numpy()).mean())
    chosen = min(val_mae, key=val_mae.get)
    log(f"projection anchor chosen on validation: {chosen} {val_mae}")
    ccol = variants[chosen]
    wv = Wp[chosen][pv["crop"].to_numpy(), pv["band"].to_numpy()]
    pv_pred = np.log(pv[ccol].to_numpy() * np.exp(wv * pv["v2"].to_numpy()) / pv[ccol].to_numpy())
    pv_resid = np.log(pv["actual"].to_numpy() / pv[ccol].to_numpy()) - pv_pred
    Qp = conformal_q(pv["crop"].to_numpy(), pv["band"].to_numpy(), pv_resid, n_crops)
    Tp = typical_error(pv["crop"].to_numpy(), pv["band"].to_numpy(), pv_resid, n_crops)

    act_p = pt["actual"].to_numpy()
    cp, bp = pt["crop"].to_numpy(), pt["band"].to_numpy()
    wk_p = pd.to_datetime(pt["origin"]).dt.to_period("W").astype(str).to_numpy()
    preds_p = {"reference_x1.05 (no model)": pt["a_ref105"].to_numpy(),
               "latest_known (no model)": pt["a_latest"].to_numpy(),
               "trailing_yoy anchor (no model)": pt["a_yoy"].to_numpy(),
               "v1_refit on ref x1.05 (as production)": pt["a_ref105"].to_numpy() * np.exp(pt["v1"].to_numpy())}
    for nm, col in variants.items():
        preds_p[f"v2_shrunk, anchor {nm}"] = pt[col].to_numpy() * np.exp(Wp[nm][cp, bp] * pt["v2"].to_numpy())
    cand_key = f"v2_shrunk, anchor {chosen}"
    preds_p["CANDIDATE = " + cand_key] = preds_p[cand_key]
    anchor_of = {k: (pt["a_ref105"].to_numpy() if "ref" in k and "v2" not in k else pt["a_latest"].to_numpy() if "latest" in k else pt["a_yoy"].to_numpy() if "yoy" in k else pt["a_ref105"].to_numpy()) for k in preds_p}
    pcols = {}

    def ptable(m):
        out = []
        for nm, pr in preds_p.items():
            a0 = pt[ccol].to_numpy() if nm.startswith("CANDIDATE") else anchor_of[nm]
            out.append(row(nm, a0[m], np.log(act_p[m] / a0[m]), np.log(pr[m] / a0[m]), "no model" not in nm))
        return out

    allm = np.ones(len(pt), bool)
    perr = lambda nm: np.abs(preds_p[nm] - act_p)   # noqa: E731
    cand_name = "CANDIDATE = " + cand_key
    cand_pred = np.log(preds_p[cand_name] / pt[ccol].to_numpy())
    clo, chi = Qp[cp, bp, 0], Qp[cp, bp, 1]
    a_c = pt[ccol].to_numpy()
    y_c = np.log(act_p / a_c)
    projection = {
        "n_validation": len(pv), "n_test": len(pt), "validation_mae_by_anchor": val_mae, "chosen_anchor": chosen,
        "trailing_yoy_share_missing_pct": float(np.isnan(yoy[sid_of[pt["o"].to_numpy()]]).mean() * 100),
        "test_overall": ptable(allm),
        "test_by_band": {BANDS[b]: ptable(bp == b) for b in range(4) if (bp == b).sum() > 50},
        "test_by_crop": {crops[c]: ptable(cp == c) for c in sorted(set(cp))},
        "skill_candidate_vs_reference": paired_boot(perr(cand_name), perr("reference_x1.05 (no model)"), wk_p, rng),
        "skill_candidate_vs_latest_known": paired_boot(perr(cand_name), perr("latest_known (no model)"), wk_p, rng),
        "skill_candidate_vs_v1_production_path": paired_boot(perr(cand_name), perr("v1_refit on ref x1.05 (as production)"), wk_p, rng),
        "intervals": {"candidate_conformal": cov_block(y_c, cand_pred, clo, chi),
                      "by_band": {BANDS[b]: cov_block(y_c, cand_pred, clo, chi, bp == b) for b in range(4) if (bp == b).sum() > 50},
                      "exact_horizon": {h_: cov_block(y_c, cand_pred, clo, chi, pt["h"].to_numpy() == h_) for h_ in EXACT if (pt["h"] == h_).sum() >= 30}},
    }
    pcells = []
    for c in sorted(set(cp)):
        for b in range(4):
            m = (cp == c) & (bp == b)
            if m.sum() >= 100:
                pcells.append({"crop": crops[c], "band": BANDS[b], "n": int(m.sum()), "w": float(Wp[chosen][c, b]),
                               "MAE_candidate": float(perr(cand_name)[m].mean()), "MAE_reference": float(perr("reference_x1.05 (no model)")[m].mean()),
                               "MAE_latest_known": float(perr("latest_known (no model)")[m].mean())})
    projection["cells"] = pcells
    log("projection scored")

    # ========================================================================= SHAP + explanation samples
    expl = {c: shap.TreeExplainer(m) for c, m in B2.items()}

    def shap_rows(X):
        hs = X["horizon_days"].to_numpy().astype(int)
        sv = np.zeros(X.shape)
        base_v = np.zeros(len(X))
        for c in needed:
            r = cand_of_h[hs] == c
            if not r.any():
                continue
            v = np.asarray(expl[c].shap_values(X[r]))
            b0 = float(np.atleast_1d(expl[c].expected_value)[0])
            if c.endswith("rate"):
                v, b = v * hs[r][:, None], b0 * hs[r]
            else:
                b = np.full(r.sum(), b0)
            sv[r], base_v[r] = v, b
        return sv, base_v

    sel = rng.choice(len(dt), min(2000, len(dt)), replace=False)
    sv_g, base_g = shap_rows(Xt2.iloc[sel].reset_index(drop=True))
    recon_g = np.abs(base_g + sv_g.sum(axis=1) - dt["v2"].to_numpy()[sel])
    gi = {g_: [V2_FEATURES.index(f) for f in fs if f in V2_FEATURES] for g_, fs in GROUPS.items()}
    used = {i for ix in gi.values() for i in ix}
    gi["other"] = [i for i in range(len(V2_FEATURES)) if i not in used]
    gsum = {g_: np.abs(sv_g[:, ix].sum(axis=1)) for g_, ix in gi.items()}
    tot = sum(gsum.values())
    shap_share = {g_: float((v / np.maximum(tot, 1e-12)).mean() * 100) for g_, v in gsum.items()}
    feat_importance = pd.Series(np.abs(sv_g).mean(axis=0), index=V2_FEATURES).sort_values(ascending=False)
    log(f"SHAP on {len(sel)} test cases; max reconstruction error {recon_g.max():.2e}")

    plans = [("Tomato", 7, "rise"), ("Cauliflower", 14, "fall"), ("Potato", 30, "rise"), ("Onion", 14, "none"),
             ("Wheat", 60, "none"), ("Cabbage", 30, "fall")]
    code_of = {nm: encoders["commodity"][nm] for nm in crops}
    err_pct = np.expm1(dt["terr"].to_numpy())
    chg = np.expm1(dt["v2s"].to_numpy())
    kind = np.where(~dt["clear"].to_numpy(), "none", np.where(chg > 0, "rise", "fall"))
    chosen_idx = []
    for crop_n, h_t, want in plans:
        c = code_of[crop_n]
        pool = None
        for hw, kw in ((2, want), (8, want), (60, want), (60, None)):
            m = (dt["crop"].to_numpy() == c) & (np.abs(dt["h"].to_numpy() - h_t) <= hw) & (np.array([k == kw for k in kind]) if kw else True)
            ok_ev = np.isfinite(base["arr_vs_month_prior"].to_numpy()[dt["o"].to_numpy()]) & np.isfinite(base["yoy_gap"].to_numpy()[dt["o"].to_numpy()])
            cand = np.flatnonzero(m & ok_ev)
            if len(cand):
                pool = cand
                break
        if pool is not None:
            chosen_idx.append(int(np.random.default_rng(SEED).choice(pool)))
    samples = []
    if chosen_idx:
        sub = dt.iloc[chosen_idx].reset_index(drop=True)
        Xs = Xt2.iloc[chosen_idx].reset_index(drop=True)
        svs, bases = shap_rows(Xs)
        for i in range(len(sub)):
            r_ = sub.iloc[i]
            o_ = int(r_["o"])
            c, b, h_ = int(r_["crop"]), int(r_["band"]), int(r_["h"])
            vals = {k: (None if not np.isfinite(float(Xs.iloc[i][k])) else float(Xs.iloc[i][k])) for k in V2_FEATURES}
            yi = int(year_index(by_year[o_]))
            nprior = int(Nyears[c, yi, by_month[o_] - 1, h_ - 1])
            lo, hi = float(r_["clo"]), float(r_["chi"])
            pr_lo = float(r_["p0"] * np.exp(r_["v2s"] + lo))
            pr_hi = float(r_["p0"] * np.exp(r_["v2s"] + hi))
            e = explain_forecast(svs[i], float(bases[i]), V2_FEATURES, vals, crop=crops[c], horizon=h_, start_price=float(r_["p0"]),
                                 origin_date=str(pd.Timestamp(r_["origin"]).date()), shrink_w=float(r_["w2"]),
                                 typical_error_log=float(r_["terr"]), reliability=reliab.get(f"{crops[c]}|{BANDS[b]}"),
                                 series_is_state=base["Market"].iloc[o_] == "All markets (state median)", n_prior_years=nprior,
                                 price_range=(pr_lo, pr_hi), model_output_log=float(r_["v2"]))
            e["series"] = {"market": str(base["Market"].iloc[o_]), "variety": str(base["Variety"].iloc[o_]), "crop": crops[c]}
            e["backtest_outcome"] = {"actual_price_on_target_date": round(float(r_["p0"] * np.exp(r_["y"])), 2),
                                     "target_date": str((pd.Timestamp(r_["origin"]) + pd.Timedelta(days=h_)).date()),
                                     "note": "known only because this is a historical backtest case"}
            samples.append(e)

    # ========================================================================= save + report
    for c, m in B2.items():
        joblib.dump(m, MODEL_DIR / f"candidate_v2_fitB_{c}.joblib", compress=3)
    np.savez_compressed(MODEL_DIR / "season_table.npz", S=S, N=Nyears)
    cand_meta = {"purpose": "EVALUATION fit of the Phase 2 candidate (fit B: targets < 2025-07-01). Not a production model.",
                 "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "features": V2_FEATURES,
                 "horizon_models": {str(h): c for h, c in horizon_model.items()}, "crops": crops,
                 "shrink_weights_real_origin": {crops[c]: {BANDS[b]: float(W2[c, b]) for b in range(4)} for c in range(len(crops))},
                 "conformal_q_log_real_origin": {crops[c]: {BANDS[b]: Q2[c, b].tolist() for b in range(4)} for c in range(len(crops))},
                 "typical_error_log_real_origin": {crops[c]: {BANDS[b]: float(T2[c, b]) for b in range(4)} for c in range(len(crops))},
                 "projection": {"chosen_anchor": chosen, "weights": {crops[c]: {BANDS[b]: float(Wp[chosen][c, b]) for b in range(4)} for c in range(len(crops))},
                                "conformal_q_log": {crops[c]: {BANDS[b]: Qp[c, b].tolist() for b in range(4)} for c in range(len(crops))}},
                 "reliability": reliab, "alpha": ALPHA, "train_cut_B": str(CUT_B)}
    (MODEL_DIR / "metadata.json").write_text(json.dumps(clean(cand_meta), indent=2), encoding="utf-8")

    p1 = None
    try:
        p1 = json.loads(PHASE1_JSON.read_text(encoding="utf-8"))
    except Exception:
        pass
    result = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "smoke_run": SMOKE,
              "settings": {"train_pairs": N_TRAIN, "alpha": ALPHA, "w_grid": W_GRID.tolist(), "min_cell": MIN_CELL, "inflation_level": level,
                           "production_model_version": meta["version"]},
              "inventory": inv, "leakage_row_features": leak_rows, "leakage_season": leak_season,
              "real_origin": real, "projection": projection,
              "shap": {"group_share_pct": shap_share, "top_features": feat_importance.head(15).round(5).to_dict(),
                       "n_cases": int(len(sel)), "max_reconstruction_error": float(recon_g.max())},
              "shrink_weights": {crops[c]: {BANDS[b]: float(W2[c, b]) for b in range(4)} for c in range(len(crops))},
              "phase1_reference": {"real_origin": p1["real_origin"]["test_overall"] if p1 else None,
                                   "projection": p1["projection"]["test_overall"] if p1 else None,
                                   "projection_intervals": p1["projection"]["intervals_test"]["production_intervals_as_shipped"] if p1 else None}}
    (OUT_DIR / "price_candidate_v2.json").write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
    (OUT_DIR / "price_candidate_v2.md").write_text(render(result, crops), encoding="utf-8")
    (OUT_DIR / "explanation_samples.json").write_text(json.dumps(clean(samples), indent=2, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "explanation_samples.md").write_text(render_samples(samples), encoding="utf-8")
    log(f"done; reports in {OUT_DIR}; candidate artifacts in {MODEL_DIR}")


# ----------------------------------------------------------------------------- report
def vl(sk: dict, name: str) -> str:
    lo, hi = sk["ci_low_pct"], sk["ci_high_pct"]
    word = "beats" if lo > 0 else "is WORSE than" if hi < 0 else "is not distinguishable from"
    return f"candidate {word} **{name}** (skill {sk['skill_pct']:+.1f} %, 95 % CI {lo:+.1f} … {hi:+.1f})"


def vl2(sk: dict, subject: str, name: str) -> str:
    lo, hi = sk["ci_low_pct"], sk["ci_high_pct"]
    word = "beats" if lo > 0 else "is WORSE than" if hi < 0 else "is not distinguishable from"
    return f"{subject} {word} **{name}** (skill {sk['skill_pct']:+.1f} %, 95 % CI {lo:+.1f} … {hi:+.1f})"


def render(r: dict, crops: list[str]) -> str:
    re_, pr, inv = r["real_origin"], r["projection"], r["inventory"]
    L = [f"# Phase 2 candidate model: backtest ({'SMOKE RUN – meaningless numbers' if r['smoke_run'] else 'final'})", "",
         f"Generated {r['created']} · compared with production model `{r['settings']['production_model_version']}` · ₹/quintal · same chronological splits as Phase 1.", ""]

    # ---- summary
    cand = re_["test_overall"][4]
    nc = re_["test_overall"][0]
    L += ["## 0. Summary (all derived from the tables below)", "",
          f"* Real-origin test ({re_['n_test']:,} cases): {vl(re_['skill_candidate_vs_no_change'], 'no change')}; "
          f"{vl(re_['skill_candidate_vs_v1_refit'], 'the production-feature model (re-fitted)')}.",
          f"* Projection test ({pr['n_test']:,} cases, chosen anchor `{pr['chosen_anchor']}`): {vl(pr['skill_candidate_vs_reference'], 'reference ×1.05')}; "
          f"{vl(pr['skill_candidate_vs_latest_known'], 'latest known price')}.",
          f"* 80 % ranges: real-origin candidate {re_['intervals']['candidate_conformal']['coverage_pct']:.0f} % covered "
          f"(production-feature model with shipped ranges {re_['intervals']['v1_with_shipped_production_intervals']['coverage_pct']:.0f} %); "
          f"projection candidate {pr['intervals']['candidate_conformal']['coverage_pct']:.0f} % "
          f"(Phase 1 shipped: {r['phase1_reference']['projection_intervals']['coverage_pct']:.0f} %)." if r["phase1_reference"]["projection_intervals"] else "", ""]

    # ---- 1 inventory
    L += ["## 1. Data inventory", "",
          f"Raw columns: {', '.join(inv['raw_columns'])}.", "",
          md_table([{"crop": a["crop"], "rows": a["rows"], "markets": a["markets"], "arrivals missing %": a["arrivals_missing_pct"],
                     "arrivals = 0 %": a["arrivals_zero_pct"], "median arrivals": a["median_arrivals"],
                     "median reporting days / market": a["median_reporting_days_per_market"]} for a in inv["arrivals_by_crop"]]),
          f"* Arrivals exist for every observed row (0 % missing) but only on days a market reported; the unit is **{inv['arrivals_unit_in_file']}** in the file. The period spans {inv['total_days']} days.",
          f"* Market→district mapping: **not available**. `market_locations.csv` has coordinates only (district column present: {inv['location_has_district_column']}); "
          f"status counts {inv['market_location_status']}. `city_market_map.csv` covers {inv['city_market_map']['markets']} markets for {inv['city_market_map']['cities']} cities.",
          "* Consequence: the market-premium feature compares a market with the Maharashtra median of the same crop (no nearby-market feature).", ""]

    # ---- 2 features
    L += ["## 2. Evidence features and leakage assertions", "",
          "| Feature | Definition (as of the origin date t) |", "|---|---|",
          "| `arr_vs_month_prior` | log( mean arrivals, last 30 days ÷ mean daily arrivals in the same calendar month of earlier years ) |",
          "| `season_change` | mean over earlier years of the log price change h days after an origin in the same month (same crop); targets inside the origin's own year only |",
          "| `market_premium_30d` (+ existing `state_price_gap`) | 30-day mean of log(market price ÷ Maharashtra median) |",
          "| `lag_90_change` (+ existing `lag_30_change`) | log(price[t] ÷ price[t−90]) |",
          "| `yoy_gap` | log(price[t] ÷ price[t−365]) |", "",
          "**Assertions executed (the script stops if any fails):**", "",
          md_table([{"feature": x["feature"], "panel cut at": x["cut"], "values compared": x["values_compared"], "mismatches": x["mismatches"],
                     "non-missing %": x["non_missing_share_pct"]} for x in r["leakage_row_features"]]),
          md_table([{"feature": x["feature"], "check": x["check"], "passed": x["passed"]} for x in r["leakage_season"]]),
          "Training rows of the candidate use `season_change` computed only from earlier years, never their own labels, so there is no target-encoding leak; rows of the first data year (2023) have no value (missing).", ""]

    # ---- 3 design
    L += ["## 3. Candidate as built", "",
          "* Same architecture, hyper-parameters and horizon→model assignment as production (xgb_rate 1–12 d, rf_rate 13–35 d, rf_plain 36–60 d), on the v2 feature set (production features + 5). Target log(price[t+h]/price[t]).",
          "* **Shrinkage:** forecast = start × exp(w · model output), w ∈ {0, 0.1, …, 1} chosen per crop × horizon band on 2025-H1 validation only (band-pooled w when a cell has < 200 validation cases). w = 0 means “keep the latest price”.",
          "* **Intervals:** split-conformal 80 % band of the validation residual (asymmetric, per crop × band, finite-sample quantile index).",
          "* **Weights w (real-origin):**", "",
          md_table([{"crop": c, **{f"{b} d": r["shrink_weights"][c][b] for b in BANDS}} for c in r["shrink_weights"]]), ""]

    # ---- 4 real
    L += ["## 4. Real-origin results (test = origins 2025-07…12)", "",
          f"Test cases {re_['n_test']:,}, validation cases {re_['n_validation']:,}. Production-feature rows are a re-fit on the same training pairs (not the shipped files).", "",
          "**Phase 1 reference (production architecture, different random sample of cases):**", ""]
    if r["phase1_reference"]["real_origin"]:
        L.append(md_table([t for t in r["phase1_reference"]["real_origin"] if t["method"] in ("model", "no_change")],
                          ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct"]))
    cols = ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct", "direction_acc_clear_calls_pct", "clear_call_rate_pct"]
    L += ["**All test cases, same cases for every row**", "", md_table(re_["test_overall"], cols), "",
          f"* {vl(re_['skill_candidate_vs_no_change'], 'no change')}",
          "* " + vl2(re_["skill_raw_v2_vs_no_change"], "raw v2 (no shrinkage)", "no change"),
          "* " + vl2(re_["skill_v1_refit_vs_no_change"], "production-feature re-fit", "no change"),
          f"* {vl(re_['skill_candidate_vs_v1_refit'], 'the production-feature re-fit')}", "",
          "`direction_acc_pct` counts moves above 5 % and treats a zero forecast as a miss; `direction_acc_clear_calls_pct` counts only forecasts whose expected change exceeds the typical error (the same rule the explanation uses).", ""]
    L += ["**By horizon band (MAE)**", ""]
    rows = []
    for b, tab in re_["test_by_band"].items():
        rows.append({"band (days)": b, "n": tab[0]["n"], **{t["method"]: t["MAE"] for t in tab},
                     "candidate skill vs no-change %": re_["skill_candidate_vs_no_change_by_band"][b]["skill_pct"],
                     "CI low": re_["skill_candidate_vs_no_change_by_band"][b]["ci_low_pct"], "CI high": re_["skill_candidate_vs_no_change_by_band"][b]["ci_high_pct"]})
    L += [md_table(rows), "**By crop (MAE)**", ""]
    rows = []
    for c, tab in re_["test_by_crop"].items():
        sk = re_["skill_candidate_vs_no_change_by_crop"][c]
        rows.append({"crop": c, "n": tab[0]["n"], **{t["method"]: t["MAE"] for t in tab}, "candidate skill %": sk["skill_pct"], "CI low": sk["ci_low_pct"],
                     "CI high": sk["ci_high_pct"], "candidate dir. acc (clear) %": tab[4]["direction_acc_clear_calls_pct"], "clear-call rate %": tab[4]["clear_call_rate_pct"]})
    L += [md_table(rows), "**Exact horizons (MAE, n)**", ""]
    rows = [{"h": h_, "n": tab[0]["n"], **{t["method"]: t["MAE"] for t in tab}} for h_, tab in re_["test_exact_horizon"].items()]
    L += [md_table(rows)]
    iv = re_["intervals"]
    L += ["**80 % ranges – actual coverage and width (test)**", "",
          md_table([{"range": "candidate conformal (all)", **iv["candidate_conformal"]},
                    {"range": "production-feature model + shipped ranges", **iv["v1_with_shipped_production_intervals"]},
                    *[{"range": f"candidate, {b} days", **v} for b, v in iv["candidate_by_band"].items()],
                    *[{"range": f"candidate, h = {h_}", **v} for h_, v in iv["candidate_exact_horizon"].items()],
                    *[{"range": f"candidate, {c}", **v} for c, v in iv["candidate_by_crop"].items()]],
                   ["range", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_start", "n"]), ""]

    # ---- 5 projection
    L += ["## 5. Projection path (2024 reference → actual 2025; test = 2025-07…12)", "",
          f"Test cases {pr['n_test']:,}; validation cases {pr['n_validation']:,}. Anchor chosen on validation MAE: **{pr['chosen_anchor']}** "
          f"(validation MAE by anchor: {', '.join(f'{k} {v:.0f}' for k, v in pr['validation_mae_by_anchor'].items())}). "
          f"Trailing-12-month YoY was missing (→ 0 %) for {pr['trailing_yoy_share_missing_pct']:.1f} % of test cases.", "",
          "**Phase 1 reference (production projection path, different sample):**", ""]
    if r["phase1_reference"]["projection"]:
        L.append(md_table([t for t in r["phase1_reference"]["projection"] if t["method"] in ("model", "reference_x1.05", "latest_known")],
                          ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct"]))
    L += ["**All test cases** (direction is measured against each method's own start price; `no model` rows have none)", "",
          md_table(pr["test_overall"], ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct"]), "",
          f"* {vl(pr['skill_candidate_vs_reference'], 'reference ×1.05')}",
          f"* {vl(pr['skill_candidate_vs_latest_known'], 'latest known price')}",
          f"* {vl(pr['skill_candidate_vs_v1_production_path'], 'the production projection path (re-fit)')}", "",
          "**By horizon band (MAE)**", ""]
    rows = []
    for b, tab in pr["test_by_band"].items():
        rows.append({"band (days)": b, "n": tab[0]["n"], **{t["method"]: t["MAE"] for t in tab if t["method"].startswith(("reference", "latest", "CANDIDATE", "v1"))}})
    L += [md_table(rows), "**By crop (MAE)**", ""]
    rows = []
    for c, tab in pr["test_by_crop"].items():
        rows.append({"crop": c, "n": tab[0]["n"], **{t["method"]: t["MAE"] for t in tab if t["method"].startswith(("reference", "latest", "CANDIDATE", "v1"))}})
    pi = pr["intervals"]
    L += [md_table(rows), "**80 % ranges – candidate, actual coverage (test)**", "",
          md_table([{"range": "all", **pi["candidate_conformal"]}, *[{"range": f"{b} days", **v} for b, v in pi["by_band"].items()],
                    *[{"range": f"h = {h_}", **v} for h_, v in pi["exact_horizon"].items()]],
                   ["range", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_start", "n"]), ""]

    # ---- 6 where it does not beat
    L += ["## 6. Where the candidate does NOT beat the no-change baseline", ""]
    bad = [c for c in re_["cells"] if c["MAE_candidate"] >= c["MAE_no_change"] - 1e-9]
    zero = [c for c in re_["cells"] if c["w"] == 0]
    L += [f"**Real-origin:** the candidate is at least as bad as no-change in {len(bad)} of {len(re_['cells'])} crop × band cells "
          f"({len(zero)} of them because the validation chose w = 0, i.e. the candidate simply reproduces no-change there).", "",
          md_table([{k: v for k, v in c.items()} for c in bad], ["crop", "band", "n", "w", "MAE_candidate", "MAE_no_change", "MAE_v1_refit"]),
          "Crops whose overall candidate skill vs no-change has a confidence interval that includes or is below zero: "
          + (", ".join(f"{c} ({s['skill_pct']:+.1f} %, {s['ci_low_pct']:+.1f}…{s['ci_high_pct']:+.1f})" for c, s in re_["skill_candidate_vs_no_change_by_crop"].items() if s["ci_low_pct"] <= 0) or "none") + ".", ""]
    bad_p = [c for c in pr["cells"] if c["MAE_candidate"] >= min(c["MAE_reference"], c["MAE_latest_known"]) - 1e-9]
    L += [f"**Projection:** the candidate is not better than the better of (reference ×1.05, latest known) in {len(bad_p)} of {len(pr['cells'])} crop × band cells.", "",
          md_table(bad_p, ["crop", "band", "n", "w", "MAE_candidate", "MAE_reference", "MAE_latest_known"]), ""]

    # ---- 7 shap
    sh = r["shap"]
    L += ["## 7. What the candidate uses (SHAP on test cases)", "",
          f"Mean share of the total absolute SHAP contribution per explanation group over {sh['n_cases']} test cases "
          f"(max |base + Σ SHAP − model output| = {sh['max_reconstruction_error']:.1e}):", "",
          md_table([{"group": TITLES.get(g, g), "mean share %": v} for g, v in sorted(sh["group_share_pct"].items(), key=lambda kv: -kv[1])]),
          "Top features by mean |SHAP|: " + ", ".join(f"{k} ({v:.3f})" for k, v in list(sh["top_features"].items())[:10]) + ".", ""]

    L += ["## 8. Limitations", "",
          "* Three years of data; one held-out half-year (real-origin) and one year pair (projection). Conclusions are suggestive. Confidence intervals resample origin weeks and understate year-to-year variation.",
          "* Shrinkage weights, conformal bands and the projection anchor come from fit A / 2025-H1 and are applied to fit B / 2025-H2; a weight chosen for one half-year may not hold in another.",
          "* The first data year (2023) has no earlier year, so `season_change`, `arr_vs_month_prior` and `yoy_gap` are missing for those training rows; tests use 2023–2024 as the earlier years.",
          "* Arrivals have no stated unit, and state-median series sum arrivals over however many markets reported that day.",
          "* The Phase 1 reference rows use a different random sample of cases than this run; only rows inside this report share identical cases.",
          "* The explanation text is a description of the model's behaviour and of measured data; it does not establish causes.", ""]
    return "\n".join(x for x in L if x is not None)


def render_samples(samples: list[dict]) -> str:
    L = ["# Sample explanations (historical backtest cases, candidate v2)", "",
         "Generated by `app/ml/price_v2/explain_v2.py` from real test-period cases (origins in 2025-H2). The outcome line is shown only because these are historical cases. "
         "Contributions show what the model did with each input; they are not proven causes.", ""]
    for i, e in enumerate(samples, 1):
        s = e["series"]
        L += [f"## Sample {i}: {s['crop']} · {s['market']} · {e['horizon_days']} days from {e['origin_date']}", "",
              f"**{e['headline']}**", ""]
        L += [f"* Start price ₹{e['start_price']:,.0f} → forecast ₹{e['predicted_price']:,.0f} ({e['predicted_change_pct']:+.1f} %)"
              + (f", 80 % range ₹{e['price_range'][0]:,.0f}–₹{e['price_range'][1]:,.0f}" if e["price_range"] else "")
              + f"; shrinkage weight {e['shrink_weight']}; typical past error ≈ {e['typical_error_pct']}%."]
        if e["why_no_direction"]:
            L.append(f"* **No clear direction:** {e['why_no_direction']}")
        L += ["", "| Factor | Pushed forecast | Share of model effect | Evidence |", "|---|---|---|---|"]
        for g in e["groups"]:
            ev = g["evidence"] or ("(no comparable data)" if g["group"] != "other" else "price level, swings, horizon and identifiers")
            tag = {"agrees": " *(the model's push matches this simple reading)*", "opposite": " *(the model's push goes the opposite way to this simple reading)*",
                   "weak": " *(too weak to indicate a direction by itself)*"}.get(g.get("evidence_vs_push"), "") if g["evidence"] else ""
            L.append(f"| {g['title']}{' (minor)' if g['minor'] else ''} | {g['pushed']} | {g['share_pct']:.0f} % | {ev}{tag} |")
        if e["confidence"]:
            L += ["", f"**How much to trust this:** {e['confidence']['text']} ({e['confidence']['basis']})"]
        L += ["", f"*Backtest outcome:* actual price on {e['backtest_outcome']['target_date']} was ₹{e['backtest_outcome']['actual_price_on_target_date']:,.0f}.", ""]
        L += [f"> {n}" for n in e["notes"]] + [""]
    return "\n".join(L)


if __name__ == "__main__":
    main()
