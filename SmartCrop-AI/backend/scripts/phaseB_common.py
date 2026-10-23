"""Shared data preparation for the Phase B scripts (new file; imports production code, changes nothing).

prepare() rebuilds exactly what scripts/backtest_candidate_v2.py builds: the production origins, the v2
evidence features, the (origin, horizon) pair arrays and the seasonal table. Nothing here touches the
2025-H2 confirmation period: callers choose which origin ranges to sample, and the Stage A scripts
only ever sample origins before 2025-07-01.
"""
from __future__ import annotations

import hashlib
import json
import warnings
from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd

import scripts.train_price_model as tpm
from app.ml.common import paths
from app.ml.price_prediction.features import (HORIZONS, MAX_HORIZON, MODEL_FEATURES, SERIES_KEY,
                                              compute_features, target_log_change, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_v2.features_v2 import (V2_FEATURES, add_evidence_features, add_pair_evidence,
                                         season_table)
from scripts.backtest_price import SeasonalRatio
from scripts.train_price_model import fit, predict, sample

warnings.filterwarnings("ignore", category=RuntimeWarning)
tpm.RF_MAX_TRAIN_ROWS = 100_000      # in-process only: faster refits for the many Phase B variants

NEW_FEATURES = ["arr_vs_month_prior", "season_change", "market_premium_30d", "lag_90_change", "yoy_gap"]
GROUP_MEMBERS = {
    "supply": ["arr_vs_month_prior", "log_arrivals", "arrivals_vs_30d"],
    "seasonal": ["season_change", "month", "week_of_year", "season_code", "doy_sin", "doy_cos",
                 "target_doy_sin", "target_doy_cos"],
    "market_premium": ["state_price_gap", "market_premium_30d", "state_change_7"],
    "recent_trend": ["lag_1_change", "lag_3_change", "lag_7_change", "lag_14_change", "lag_30_change",
                     "lag_90_change", "pct_change_7", "roll_mean_7_gap", "roll_mean_14_gap",
                     "roll_mean_30_gap", "momentum_7_30"],
    "last_year": ["yoy_gap"],
}


def variant_table() -> dict[str, dict]:
    """The 12 Task-3 variants: name -> {cols, ref, kind}. Add-ons are compared with v1, drop-outs with v2."""
    out = {"v1": {"cols": list(MODEL_FEATURES), "ref": None, "kind": "reference"},
           "v2": {"cols": list(V2_FEATURES), "ref": "v1", "kind": "combined"}}
    for f in NEW_FEATURES:
        out[f"add_{f}"] = {"cols": list(MODEL_FEATURES) + [f], "ref": "v1", "kind": "add-on", "feature": f}
    for g, members in GROUP_MEMBERS.items():
        out[f"drop_{g}"] = {"cols": [c for c in V2_FEATURES if c not in members], "ref": "v2", "kind": "drop-out", "group": g}
    return out


def content_hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def prepare(log) -> SimpleNamespace:
    c = SimpleNamespace()
    c.meta = json.loads((paths.PRICE_MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
    prep = joblib.load(paths.PRICE_MODEL_DIR / "price_preprocessing.joblib")
    assert list(prep["feature_columns"]) == list(MODEL_FEATURES)
    c.encoders = prep["encoders"]
    c.crops = sorted(c.encoders["commodity"], key=c.encoders["commodity"].get)
    c.n_crops = max(c.encoders["commodity"].values()) + 1
    c.horizon_model = {int(h): m for h, m in c.meta["horizon_models"].items()}
    c.cand_of_h = np.array([c.horizon_model.get(h, "") for h in range(0, MAX_HORIZON + 1)])
    c.needed = sorted(set(c.horizon_model.values()))

    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    c.panel = panel
    feat = compute_features(panel, c.encoders, with_targets=True)
    mask = usable_origin_mask(feat).to_numpy()            # identical origins to production
    ev = add_evidence_features(feat)
    ev["sid"] = ev.groupby(SERIES_KEY, sort=False).ngroup()
    c.feat, c.ev, c.mask = feat, ev, mask
    c.featidx = np.flatnonzero(mask)
    base = ev[mask].reset_index(drop=True)
    c.base = base
    n, H = len(base), MAX_HORIZON
    c.n, c.H = n, H
    log(f"usable origins {n:,}")

    # outlier-capped flags (cleaning step) aligned to the panel rows
    cl = pd.read_parquet(paths.PRICE_CLEAN_PATH)
    cap = cl.loc[cl["outlier_capped"], [*SERIES_KEY, "Date"]].copy()
    for k in SERIES_KEY:
        cap[k] = cap[k].astype(str)
    cap["_cap"] = True
    key = feat[[*SERIES_KEY, "Date"]].copy()
    for k in SERIES_KEY:
        key[k] = key[k].astype(str)
    c.capped = key.merge(cap, on=[*SERIES_KEY, "Date"], how="left")["_cap"].fillna(False).to_numpy(bool)

    g = ev.groupby(SERIES_KEY, sort=False)["log_price"]
    lag365 = g.shift(365).to_numpy()[mask]
    Y = np.empty((n, H), "float32")
    SN = np.empty((n, H), "float32")
    YA = np.empty((n, H), "float32")
    for h in HORIZONS:
        Y[:, h - 1] = target_log_change(ev, h).to_numpy()[mask]
        lp_t = g.shift(365 - h).to_numpy()[mask]
        YA[:, h - 1], SN[:, h - 1] = lp_t, lp_t - lag365
    c.Y = Y
    c.oi = np.repeat(np.arange(n, dtype="int32"), H)
    c.hh = np.tile(np.asarray(HORIZONS, dtype="int16"), n)
    c.y_all, sn_all, ya_all = Y.ravel(), SN.ravel(), YA.ravel()
    c.origin_day = base["Date"].to_numpy().astype("datetime64[D]")
    c.pair_origin = c.origin_day[c.oi]
    c.pair_target = c.pair_origin + c.hh.astype("timedelta64[D]")
    c.has_target = np.isfinite(c.y_all)
    c.defined = c.has_target & np.isfinite(sn_all) & np.isfinite(ya_all)   # Phase 1/2 case population
    c.logp0 = base["log_price"].to_numpy()
    c.crop_code = base["commodity_code"].to_numpy(int)
    c.sid_of = base["sid"].to_numpy()
    c.by_year = base["Date"].dt.year.to_numpy()
    c.by_month = base["Date"].dt.month.to_numpy()
    c.S, c.Nyears = season_table(c.crop_code, c.by_year, c.by_month, c.origin_day, Y, c.n_crops)
    c.seas = SeasonalRatio(feat.assign(sid=ev["sid"]))
    return c


def X1_of(c, idx):
    return with_pair_features(c.base.iloc[c.oi[idx]], c.hh[idx])


def X2_of(c, idx):
    o = c.base.iloc[c.oi[idx]]
    return add_pair_evidence(with_pair_features(o, c.hh[idx]), o, c.hh[idx], c.S)


def fit_models(c, X: pd.DataFrame, y: np.ndarray, cols: list[str]) -> dict:
    Xc = X[cols]
    return {m: fit(m, Xc, y) for m in c.needed}


def predict_all(c, models: dict, X: pd.DataFrame) -> np.ndarray:
    hs = X["horizon_days"].to_numpy().astype(int)
    out = np.empty(len(X), "float32")
    for m in c.needed:
        r = c.cand_of_h[hs] == m
        if r.any():
            out[r] = predict(m, models[m], X[r])
    return out


def cases_frame(c, idx: np.ndarray) -> pd.DataFrame:
    """Case table for sampled pair indices (no predictions)."""
    o, h = c.oi[idx], c.hh[idx].astype(int)
    fi = c.featidx[o]
    return pd.DataFrame({
        "idx": idx, "o": o, "crop": c.crop_code[o], "h": h,
        "band": np.digitize(h, [8, 15, 31]), "origin": c.origin_day[o],
        "p0": np.exp(c.logp0[o]), "y": c.y_all[idx].astype(float),
        "market": c.base["Market"].to_numpy()[o], "variety": c.base["Variety"].to_numpy()[o],
        "is_state": (c.base["Market"].to_numpy()[o] == "All markets (state median)"),
        "capped_origin": c.capped[fi], "capped_target": c.capped[fi + h]})
