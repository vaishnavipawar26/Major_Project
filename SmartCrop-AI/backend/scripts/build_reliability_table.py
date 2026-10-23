"""Backtest reliability table (crop x horizon band) for the production price model, used by the explanation's trust block.

Run from backend/:   python -m scripts.build_reliability_table        (EVAL_SMOKE=1 = tiny code-path check)

Writes backend/trained_models/price_reliability/reliability_v1.json (a NEW folder; no production file is touched).
The shipped model files were trained on all data through 2025, so scoring them on 2025 would be in-sample. As in the
Phase 1 backtest the production ARCHITECTURE and horizon->model assignment are re-fitted in memory on earlier data only:

  real_origin  forecasts from the market's own recent prices (fit B: pairs with targets before 2025-07-01),
               test origins 2025-07 .. 2025-12;  baseline = "price stays unchanged"
  projection   what the application does while its price records are out of date: reference-year (2024) prices x 1.05
               as the starting price and the model's ratio applied to it (fit A: targets before 2025-01-01),
               actual = the real 2025 price on the same dates (origins 2025-07 .. 2025-12);
               baseline = the starting price itself (the model's ratio set to 1), also reported: the latest known price

Per cell: cases, MAE and WAPE (price space), the baseline's MAE, whether the model beats the baseline, direction
accuracy on moves above 5 % (with the number of such moves), and the real coverage and width of the shipped 80 % range.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import MODEL_FEATURES
from scripts.backtest_price import BANDS, band_idx, clean, production_interval
from scripts.phaseB_common import X1_of, fit_models, predict_all, prepare
from scripts.train_price_model import sample

SMOKE = os.getenv("EVAL_SMOKE") == "1"
OUT = Path(os.getenv("EVAL_OUT_DIR", paths.MODELS_DIR / "price_reliability"))
N_TRAIN = 20_000 if SMOKE else 300_000
N_REAL = 4_000 if SMOKE else 300_000
N_PROJ = 4_000 if SMOKE else 200_000
SEED = 31
CUT_A, CUT_B = np.datetime64("2025-01-01"), np.datetime64("2025-07-01")
TEST_START, TEST_END = np.datetime64("2025-07-01"), np.datetime64("2025-12-31")
MIN_DIRECTION_MOVES = 30


def stats(p0, y, pred, lo, hi, baseline_name, extra_baseline=None) -> dict:
    act = p0 * np.exp(y)
    err_m = np.abs(p0 * np.exp(pred) - act)
    err_b = np.abs(p0 - act)
    mv = np.abs(np.expm1(y)) > 0.05
    inside = (y >= pred + lo) & (y <= pred + hi)
    out = {"n": int(len(y)), "mae": float(err_m.mean()), "wape_pct": float(err_m.sum() / act.sum() * 100),
           "baseline": baseline_name, "baseline_mae": float(err_b.mean()), "baseline_wape_pct": float(err_b.sum() / act.sum() * 100),
           "beats_baseline": bool(err_m.mean() < err_b.mean()),
           "skill_vs_baseline_pct": float((1 - err_m.sum() / err_b.sum()) * 100),
           "n_meaningful_moves": int(mv.sum()),
           "up_share_of_moves_pct": float((y[mv] > 0).mean() * 100) if mv.any() else None,
           "direction_acc_pct": float((np.sign(pred[mv]) == np.sign(y[mv])).mean() * 100) if mv.sum() >= MIN_DIRECTION_MOVES else None,
           "range_coverage_pct": float(inside.mean() * 100),
           "range_below_pct": float((y < pred + lo).mean() * 100), "range_above_pct": float((y > pred + hi).mean() * 100),
           "range_mean_width_pct_of_start": float(((np.exp(pred + hi) - np.exp(pred + lo)) * 100).mean())}
    if extra_baseline is not None:
        out["latest_known_mae"] = float(np.abs(extra_baseline - act).mean())
    return out


def tables(df: pd.DataFrame, crops: list[str], baseline_name: str, extra=None) -> dict:
    p0, y, pred = df["p0"].to_numpy(), df["y"].to_numpy(), df["pred"].to_numpy()
    lo, hi = df["lo"].to_numpy(), df["hi"].to_numpy()
    ex = None if extra is None else df[extra].to_numpy()

    def one(m):
        return stats(p0[m], y[m], pred[m], lo[m], hi[m], baseline_name, None if ex is None else ex[m])

    out = {"all": one(np.ones(len(df), bool)), "cells": {}, "crops": {}, "bands": {}}
    for ci in sorted(df["crop"].unique()):
        mc = (df["crop"] == ci).to_numpy()
        out["crops"][crops[ci]] = one(mc)
        for b in range(4):
            m = mc & (df["band"] == b).to_numpy()
            if m.sum() >= 30:
                out["cells"][f"{crops[ci]}|{BANDS[b]}"] = one(m)
    for b in range(4):
        m = (df["band"] == b).to_numpy()
        if m.any():
            out["bands"][BANDS[b]] = one(m)
    return out


def main() -> None:
    t0 = time.time()
    log = lambda s: print(f"[{time.time() - t0:5.0f}s] {s}", flush=True)   # noqa: E731
    rng = np.random.default_rng(SEED)
    c = prepare(log)
    crops = c.crops
    cols = list(MODEL_FEATURES)
    result = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "smoke_run": SMOKE,
              "model_version": c.meta["version"], "model_data_end": c.meta["data_end"], "test_period": "origins 2025-07-01 .. 2025-12-31",
              "method": ("Production architecture and horizon->model assignment re-fitted in memory on earlier data only "
                         f"({N_TRAIN:,} pairs, random forests capped at 100,000 rows); NOT the shipped files, which saw 2025. "
                         "Ranges are the shipped 80% ranges from metadata.json."),
              "scenarios": {}}

    # ---- real-origin (fit B)
    tr = sample(rng, c.has_target & (c.pair_target < CUT_B), N_TRAIN)
    assert c.pair_target[tr].max() < CUT_B
    X = X1_of(c, tr)
    models = fit_models(c, X, c.y_all[tr], cols)
    idx = sample(rng, c.defined & (c.pair_origin >= TEST_START) & (c.pair_origin <= TEST_END), N_REAL)
    o, h = c.oi[idx], c.hh[idx].astype(int)
    pred = predict_all(c, models, X1_of(c, idx)[cols]).astype(float)
    df = pd.DataFrame({"crop": c.crop_code[o], "h": h, "band": band_idx(h), "p0": np.exp(c.logp0[o]), "y": c.y_all[idx].astype(float), "pred": pred})
    df["lo"], df["hi"] = production_interval(c.meta, df.assign(crop=[crops[i] for i in df["crop"]]))
    result["scenarios"]["real_origin"] = {"cases": len(df), "baseline": "price stays unchanged", **tables(df, crops, "price stays unchanged")}
    log(f"real-origin scored: {len(df):,} cases")

    # ---- projection (fit A; 2024 reference -> actual 2025)
    tr = sample(rng, c.has_target & (c.pair_target < CUT_A), N_TRAIN)
    assert c.pair_target[tr].max() < CUT_A
    X = X1_of(c, tr)
    models = fit_models(c, X, c.y_all[tr], cols)
    py, pm = c.by_year[c.oi], c.by_month[c.oi]
    idx = sample(rng, (py == 2024) & (pm >= 7) & (pm <= 12), int(N_PROJ * 1.3))
    o, h = c.oi[idx], c.hh[idx].astype(int)
    od = pd.DatetimeIndex(c.origin_day[o])
    d2 = (od + pd.DateOffset(years=1)) + pd.to_timedelta(h, unit="D")
    tp = c.feat.assign(sid=c.ev["sid"]).loc[c.feat["target_price"].notna(), ["sid", "Date", "target_price"]]
    pairs = pd.DataFrame({"sid": c.sid_of[o], "Date": d2.to_numpy(), "k": np.arange(len(o))})
    actual = pairs.merge(tp, on=["sid", "Date"], how="left").sort_values("k")["target_price"].to_numpy()
    f = c.feat
    lk = f[f["observed"] & (f["Date"] <= pd.Timestamp("2024-12-31"))].groupby(c.ev["sid"])["price"].last().reindex(c.sid_of[o]).to_numpy()
    keep = np.isfinite(actual) & np.isfinite(lk)
    idx, o, h, actual, lk = idx[keep], o[keep], h[keep], actual[keep], lk[keep]
    p0 = np.exp(c.logp0[o]) * 1.05
    pred = predict_all(c, models, X1_of(c, idx)[cols]).astype(float)
    df = pd.DataFrame({"crop": c.crop_code[o], "h": h, "band": band_idx(h), "p0": p0, "y": np.log(actual / p0), "pred": pred, "lk": lk})
    df["lo"], df["hi"] = production_interval(c.meta, df.assign(crop=[crops[i] for i in df["crop"]]))
    result["scenarios"]["projection"] = {"cases": len(df), "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
                                         **tables(df, crops, "starting price (reference-year price x 1.05, model ratio = 1)", extra="lk")}
    log(f"projection scored: {len(df):,} cases")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "reliability_v1.json").write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
    # the per-cell policy (model / context-only) is built from this table by scripts.build_crop_policy
    log(f"done; wrote {OUT / 'reliability_v1.json'}")


if __name__ == "__main__":
    main()
