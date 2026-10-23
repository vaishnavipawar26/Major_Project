"""Phase B, Stage A, Task 4: how should a forecast be shown when the price records end long before today?

Run from backend/:   python -m scripts.phaseB_projection        (EVAL_SMOKE=1 = tiny code-path check)

Two year pairs (no 2025-H2 confirmation case is built; no production behaviour is changed):
  P1  2023 -> 2024  model-free only (there is no data to train a model before 2023)
  P2  2024 -> 2025-H1  (origins Jan-Jun 2025; fit A = pairs with targets before 2025-01-01)
For a simulated user whose price records end at the end of the reference year, the methods are:
  latest_known            last price actually observed by the data end (no model, 0 % inflation)
  reference_x1.05         the reference-year price at the same date x 1.05 (the current production anchor)
  reference_x1.00         same without inflation
  trailing_yoy            reference price x the series' own trailing-12-month growth (P2 only)
  v1 / v2 model           the model's ratio applied to the reference_x1.05 start (P2 only)
  historical_projection   the production fallback (_forecast_baseline logic) on a subset (P2 only)
Pre-registered display policy (decided from these numbers, NOT yet applied to production):
  * an anchor replaces latest_known only if it beats it with a 95 % interval above 0 in BOTH pairs;
  * a model adjustment is recommended only if it beats its own anchor AND latest_known with an interval above 0 in P2;
  * a price range is shown only if its coverage is >= 75 % when calibrated on one pair and checked on the other.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import SERIES_KEY
from app.ml.price_prediction.forecaster import BASELINE_ANCHOR_OBS, PriceForecaster
from scripts.backtest_candidate_v2 import conformal_q, cov_block
from scripts.backtest_price import BANDS, band_idx, clean, md_table, metrics, paired_boot
from scripts.phaseB_common import X1_of, X2_of, content_hash, fit_models, predict_all, prepare
from app.ml.price_prediction.features import MODEL_FEATURES
from app.ml.price_v2.features_v2 import V2_FEATURES
from scripts.train_price_model import sample

SMOKE = os.getenv("EVAL_SMOKE") == "1"
OUT_DIR = Path(os.getenv("EVAL_OUT_DIR", paths.REPORTS_DIR))
N_TRAIN = 20_000 if SMOKE else 200_000
N_CASES = 4_000 if SMOKE else 100_000
N_HIST = 1_500 if SMOKE else 20_000
SEED = 23
CUT_A = np.datetime64("2025-01-01")
CONFIRMATION_START = np.datetime64("2025-07-01")
EXACT = (1, 7, 14, 30, 60)
MIN_COVERAGE = 75.0


def main() -> None:
    t0 = time.time()
    log = lambda s: print(f"[{time.time() - t0:5.0f}s] {s}", flush=True)   # noqa: E731
    rng = np.random.default_rng(SEED)
    rboot = np.random.default_rng(SEED + 1)
    c = prepare(log)
    crops = c.crops
    py, pm = c.by_year[c.oi], c.by_month[c.oi]
    tp = c.feat.assign(sid=c.ev["sid"]).loc[c.feat["target_price"].notna(), ["sid", "Date", "target_price"]]

    def last_known(data_end: str) -> pd.Series:
        f = c.feat
        return f[f["observed"] & (f["Date"] <= pd.Timestamp(data_end))].groupby(c.ev["sid"])["price"].last()

    def trailing_yoy(ref_year: int) -> np.ndarray:
        out = np.full(int(c.ev["sid"].max()) + 1, np.nan)
        for sid, (d, p) in c.seas.arr.items():
            a = (d >= np.datetime64(f"{ref_year}-01-01")) & (d <= np.datetime64(f"{ref_year}-12-31"))
            b = (d >= np.datetime64(f"{ref_year - 1}-01-01")) & (d <= np.datetime64(f"{ref_year - 1}-12-31"))
            if a.sum() >= 60 and b.sum() >= 60:
                out[sid] = np.clip(np.log(p[a].mean() / p[b].mean()), -0.5, 0.5)
        return out

    def cases(ref_year, m_lo, m_hi, size, with_yoy):
        idx = sample(rng, (py == ref_year) & (pm >= m_lo) & (pm <= m_hi), int(size * 1.3))
        o, h = c.oi[idx], c.hh[idx].astype(int)
        od = pd.DatetimeIndex(c.origin_day[o])
        d2 = (od + pd.DateOffset(years=1)) + pd.to_timedelta(h, unit="D")
        pairs = pd.DataFrame({"sid": c.sid_of[o], "Date": d2.to_numpy(), "k": np.arange(len(o))})
        actual = pairs.merge(tp, on=["sid", "Date"], how="left").sort_values("k")["target_price"].to_numpy()
        lk = last_known(f"{ref_year}-12-31").reindex(c.sid_of[o]).to_numpy()
        pref = np.exp(c.logp0[o])
        yo = trailing_yoy(ref_year)[c.sid_of[o]] if with_yoy else np.full(len(o), np.nan)
        keep = np.isfinite(actual) & np.isfinite(lk)
        keep &= (d2.to_numpy().astype("datetime64[D]") < CONFIRMATION_START) | (np.datetime64(f"{ref_year}-01-01") < np.datetime64("2024-01-01"))
        assert (d2[keep].to_numpy().astype("datetime64[D]") <= np.datetime64("2025-08-31")).all()
        df = pd.DataFrame({"idx": idx[keep], "o": o[keep], "crop": c.crop_code[o][keep], "h": h[keep], "band": band_idx(h[keep]),
                           "origin": (od[keep] + pd.DateOffset(years=1)).to_numpy(), "actual": actual[keep], "lk": lk[keep],
                           "ref105": pref[keep] * 1.05, "ref100": pref[keep],
                           "yoy": pref[keep] * np.exp(yo[keep]) if with_yoy else np.nan})
        assert (pd.to_datetime(df["origin"]) < pd.Timestamp("2025-07-01")).all(), "confirmation origins must not be built"
        return df

    P1 = cases(2023, 1, 12, N_CASES, with_yoy=False)
    P2 = cases(2024, 1, 6, N_CASES, with_yoy=True)
    log(f"cases: P1 (2023->2024) {len(P1):,}, P2 (2024->2025-H1) {len(P2):,}")

    # ------------------------------------------------------------------ models for P2 (fit A, targets < 2025-01-01)
    tr = sample(rng, c.has_target & (c.pair_target < CUT_A), N_TRAIN)
    assert c.pair_target[tr].max() < CUT_A
    Xtr, ytr = X2_of(c, tr), c.y_all[tr]
    Xp = X2_of(c, P2["idx"].to_numpy())
    pm1 = predict_all(c, fit_models(c, Xtr, ytr, list(MODEL_FEATURES)), Xp[list(MODEL_FEATURES)]).astype(float)
    pm2 = predict_all(c, fit_models(c, Xtr, ytr, list(V2_FEATURES)), Xp[list(V2_FEATURES)]).astype(float)
    P2["m_v1"], P2["m_v2"] = pm1, pm2
    log("fit A models (v1, v2) fitted and applied to P2")

    def price_methods(df, with_models):
        m = {"latest_known": df["lk"].to_numpy(), "reference_x1.05": df["ref105"].to_numpy(), "reference_x1.00": df["ref100"].to_numpy()}
        if df["yoy"].notna().any():
            m["trailing_yoy"] = np.where(np.isfinite(df["yoy"]), df["yoy"], df["ref100"]).astype(float)
        if with_models:
            m["v1_model_on_ref_x1.05"] = df["ref105"].to_numpy() * np.exp(df["m_v1"].to_numpy())
            m["v2_model_on_ref_x1.05"] = df["ref105"].to_numpy() * np.exp(df["m_v2"].to_numpy())
        return m

    def table(df, methods, mask=None):
        m = np.ones(len(df), bool) if mask is None else mask
        rows = []
        for nm, pr in methods.items():
            start = df["ref105"].to_numpy() if "model" in nm else (df["lk"].to_numpy() if nm == "latest_known" else pr)
            rows.append({"method": nm, **metrics(start[m], np.log(df["actual"].to_numpy()[m] / start[m]), np.log(pr[m] / start[m]),
                                                 "model" in nm)})
        return rows

    def week(df):
        return pd.to_datetime(df["origin"]).dt.to_period("W").astype(str).to_numpy()

    res = {}
    for pname, df, with_models in (("P1_2023_to_2024", P1, False), ("P2_2024_to_2025H1", P2, True)):
        meth = price_methods(df, with_models)
        act = df["actual"].to_numpy()
        e = {k: np.abs(v - act) for k, v in meth.items()}
        wk = week(df)
        bands = df["band"].to_numpy()
        crop = df["crop"].to_numpy()
        entry = {"n": len(df), "origin_months_covered": sorted(set(pd.to_datetime(df["origin"]).dt.month)),
                 "overall": table(df, meth),
                 "by_band": {BANDS[b]: table(df, meth, bands == b) for b in range(4) if (bands == b).sum() > 50},
                 "by_crop": {crops[ci]: table(df, meth, crop == ci) for ci in sorted(set(crop))},
                 "exact_horizon": {h: table(df, meth, df["h"].to_numpy() == h) for h in EXACT if (df["h"] == h).sum() >= 30},
                 "skill_vs_latest_known": {k: paired_boot(e[k], e["latest_known"], wk, rboot) for k in meth if k != "latest_known"}}
        if with_models:
            entry["skill_model_vs_own_anchor"] = {"v1": paired_boot(e["v1_model_on_ref_x1.05"], e["reference_x1.05"], wk, rboot),
                                                  "v2": paired_boot(e["v2_model_on_ref_x1.05"], e["reference_x1.05"], wk, rboot)}
        # per-crop winner among the three no-model anchors
        win = {}
        for ci in sorted(set(crop)):
            mm = crop == ci
            maes = {k: float(e[k][mm].mean()) for k in ("latest_known", "reference_x1.05", "reference_x1.00")}
            win[crops[ci]] = {"best": min(maes, key=maes.get), **maes, "n": int(mm.sum())}
        entry["per_crop_best_anchor"] = win
        res[pname] = entry
        log(f"{pname} scored")

    # ------------------------------------------------------------------ production historical projection (P2 subset)
    sub = P2.sample(min(N_HIST, len(P2)), random_state=SEED).reset_index(drop=True)
    mid = np.full(len(sub), np.nan)
    wid = np.full(len(sub), np.nan)
    start = np.full(len(sub), np.nan)
    spread_cache = {}
    for i, (o, h) in enumerate(zip(sub["o"], sub["h"])):
        sid = int(c.sid_of[o])
        dates, prices = c.seas.arr[sid]
        k = int(np.searchsorted(dates, c.origin_day[o], side="right"))
        if k < 3:
            continue
        ratio, yrs = c.seas.ratio(sid, c.origin_day[o].astype(object), int(h))
        if o not in spread_cache:
            spread_cache[o] = PriceForecaster._log_spread(pd.DataFrame({"Date": pd.to_datetime(dates[:k]), "price": prices[:k]}))
        start[i] = float(np.median(prices[max(0, k - BASELINE_ANCHOR_OBS):k])) * 1.05
        mid[i] = start[i] * ratio
        wid[i] = 1.2816 * spread_cache[o] * np.sqrt(h / 7)
    ok = np.isfinite(mid)
    hs = sub[ok].reset_index(drop=True)
    mid, wid, start = mid[ok], wid[ok], start[ok]
    act = hs["actual"].to_numpy()
    hist_methods = {"historical_projection": mid, "latest_known": hs["lk"].to_numpy(), "reference_x1.05": hs["ref105"].to_numpy(),
                    "v1_model_on_ref_x1.05": hs["ref105"].to_numpy() * np.exp(hs["m_v1"].to_numpy()),
                    "v2_model_on_ref_x1.05": hs["ref105"].to_numpy() * np.exp(hs["m_v2"].to_numpy())}
    eh = {k: np.abs(v - act) for k, v in hist_methods.items()}
    inside = (act >= mid * np.exp(-wid)) & (act <= mid * np.exp(wid))
    res["historical_projection_subset_P2"] = {
        "n": int(len(hs)), "table": [{"method": k, "n": len(hs), "MAE": float(e_.mean()), "WAPE_pct": float(e_.sum() / act.sum() * 100)} for k, e_ in eh.items()],
        "skill_historical_vs_latest_known": paired_boot(eh["historical_projection"], eh["latest_known"], week(hs), rboot),
        "skill_historical_vs_reference": paired_boot(eh["historical_projection"], eh["reference_x1.05"], week(hs), rboot),
        "own_range": {"coverage_pct": float(inside.mean() * 100), "mean_width_pct_of_forecast": float(((np.exp(wid) - np.exp(-wid)) * 100).mean()),
                      "below_pct": float((act < mid * np.exp(-wid)).mean() * 100)}}
    log("historical projection subset scored")

    # ------------------------------------------------------------------ ranges: calibrate on one pair, check on the other
    ranges = {}
    for anchor_name, col in (("latest_known", "lk"), ("reference_x1.05", "ref105")):
        out = {}
        for src, dst, nm in ((P1, P2, "calibrate on P1 -> check on P2"), (P2, P1, "calibrate on P2 -> check on P1")):
            rs = np.log(src["actual"].to_numpy() / src[col].to_numpy())
            Q = conformal_q(src["crop"].to_numpy(), src["band"].to_numpy(), rs, c.n_crops)
            lo, hi = Q[dst["crop"].to_numpy(), dst["band"].to_numpy(), 0], Q[dst["crop"].to_numpy(), dst["band"].to_numpy(), 1]
            yk = np.log(dst["actual"].to_numpy() / dst[col].to_numpy())
            out[nm] = {"overall": cov_block(yk, np.zeros(len(yk)), lo, hi),
                       "by_band": {BANDS[b]: cov_block(yk, np.zeros(len(yk)), lo, hi, dst["band"].to_numpy() == b) for b in range(4) if (dst["band"] == b).sum() > 50}}
        ranges[anchor_name] = out
    res["ranges_cross_pair"] = ranges

    # ------------------------------------------------------------------ pre-registered policy applied to the numbers
    pol = {}
    for anc in ("reference_x1.05", "reference_x1.00"):
        s1 = res["P1_2023_to_2024"]["skill_vs_latest_known"][anc]
        s2 = res["P2_2024_to_2025H1"]["skill_vs_latest_known"][anc]
        pol[f"{anc}_replaces_latest_known"] = {"P1": s1, "P2": s2, "adopted": bool(s1["ci_low_pct"] > 0 and s2["ci_low_pct"] > 0)}
    mod = {}
    for mname in ("v1", "v2"):
        own = res["P2_2024_to_2025H1"]["skill_model_vs_own_anchor"][mname]
        lkv = res["P2_2024_to_2025H1"]["skill_vs_latest_known"][f"{mname}_model_on_ref_x1.05"]
        mod[mname] = {"vs_own_anchor": own, "vs_latest_known": lkv, "adopted": bool(own["ci_low_pct"] > 0 and lkv["ci_low_pct"] > 0)}
    pol["model_adjustment"] = mod
    cov_ok = {a: all(v["overall"]["coverage_pct"] >= MIN_COVERAGE for v in out.values()) for a, out in ranges.items()}
    pol["range_shown"] = {a: bool(ok) for a, ok in cov_ok.items()}
    anchor_adopted = [a for a in ("reference_x1.05", "reference_x1.00") if pol[f"{a}_replaces_latest_known"]["adopted"]]
    model_adopted = [m for m, v in mod.items() if v["adopted"]]
    rec_ = {"headline_anchor": anchor_adopted[0] if anchor_adopted else "latest_known",
            "model_adjustment": model_adopted[0] if model_adopted else None,
            "show_range": bool(any(cov_ok.values())),
            "recommended_display": (
                "Show the latest known price with its date as the headline. Present anything beyond the end of the price records as a clearly labelled "
                "scenario based on last year's pattern, not as an accurate forecast, and do not show a price range."
                if not anchor_adopted and not model_adopted and not any(cov_ok.values()) else
                "See the numbers: at least one pre-registered condition was met; the applicable part of the policy may be used."),
            "applied_to_production": False}
    pol["recommendation"] = rec_
    res["policy"] = pol
    decision = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "smoke_run": SMOKE,
                "status": "FROZEN projection display recommendation (not applied to production)", "policy_rules": {
                    "anchor": "replace latest_known only if CI low > 0 vs latest_known in BOTH pairs",
                    "model_adjustment": "only if it beats its own anchor AND latest_known with CI low > 0 in P2",
                    "range": f"only if coverage >= {MIN_COVERAGE}% when calibrated on one pair and checked on the other"},
                "recommendation": rec_}
    decision["content_sha256"] = content_hash({k: v for k, v in decision.items() if k not in ("created", "content_sha256")})
    result = {"created": decision["created"], "smoke_run": SMOKE, "n_train_pairs": N_TRAIN, "results": res, "decision_hash": decision["content_sha256"]}
    (OUT_DIR / "phaseB_projection_decision.json").write_text(json.dumps(clean(decision), indent=2), encoding="utf-8")
    (OUT_DIR / "phaseB_projection.json").write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
    (OUT_DIR / "phaseB_projection.md").write_text(render(result, decision, crops), encoding="utf-8")
    log(f"done; reports in {OUT_DIR}")


def vl(sk, subject, name):
    lo, hi = sk["ci_low_pct"], sk["ci_high_pct"]
    word = "beats" if lo > 0 else "is WORSE than" if hi < 0 else "is not distinguishable from"
    return f"{subject} {word} **{name}** (skill {sk['skill_pct']:+.1f} %, 95 % CI {lo:+.1f} … {hi:+.1f})"


def render(r, dec, crops) -> str:
    R = r["results"]
    L = [f"# Phase B Stage A, Task 4: handling projection forecasts ({'SMOKE RUN – meaningless numbers' if r['smoke_run'] else 'final'})", "",
         f"Generated {r['created']}. ₹/quintal. A simulated user's price records end at the end of the reference year. "
         "P1 = 2023 → 2024 (model-free only); P2 = 2024 → 2025, origins Jan–Jun 2025 only (the 2025-H2 confirmation origins were **not** built). "
         "Models for P2 are fitted on pairs with targets before 2025-01-01.", ""]
    for pn, title in (("P1_2023_to_2024", "P1: 2023 → 2024 (model-free)"), ("P2_2024_to_2025H1", "P2: 2024 → 2025-H1")):
        d = R[pn]
        L += [f"## {title}", "", f"Cases: {d['n']:,}; origin months covered: {d['origin_months_covered']}.", "",
              "**All cases**", "", md_table(d["overall"], ["method", "n", "MAE", "WAPE_pct", "direction_acc_pct", "n_meaningful", "up_share_of_meaningful_pct"]), "",
              "**Versus the latest known price (95 % CI, origin-week bootstrap):**", ""]
        L += [f"* {vl(s, k, 'latest known price')}" for k, s in d["skill_vs_latest_known"].items()]
        if "skill_model_vs_own_anchor" in d:
            L += [f"* {vl(s, k + ' model', 'its own anchor (reference × 1.05)')}" for k, s in d["skill_model_vs_own_anchor"].items()]
        L += ["", "**By horizon band (MAE)**", ""]
        rows = [{"band": b, "n": t[0]["n"], **{x["method"]: x["MAE"] for x in t}} for b, t in d["by_band"].items()]
        L += [md_table(rows), "**By crop (MAE) and the best of the three no-model anchors**", ""]
        rows = [{"crop": cn, "n": t[0]["n"], **{x["method"]: x["MAE"] for x in t}, "best anchor": d["per_crop_best_anchor"][cn]["best"]} for cn, t in d["by_crop"].items()]
        L += [md_table(rows), "**Exact horizons (MAE)**", ""]
        rows = [{"h": h, "n": t[0]["n"], **{x["method"]: x["MAE"] for x in t}} for h, t in d["exact_horizon"].items()]
        L += [md_table(rows), ""]
    best1 = {cn: v["best"] for cn, v in R["P1_2023_to_2024"]["per_crop_best_anchor"].items()}
    best2 = {cn: v["best"] for cn, v in R["P2_2024_to_2025H1"]["per_crop_best_anchor"].items()}
    L += ["## Is the best anchor stable across the two year pairs?", "",
          md_table([{"crop": cn, "best in P1": best1.get(cn), "best in P2": best2.get(cn), "same": best1.get(cn) == best2.get(cn)} for cn in crops if cn in best1 and cn in best2]), ""]
    h = R["historical_projection_subset_P2"]
    L += ["## Production historical projection (P2 subset, scored separately)", "", f"Cases: {h['n']:,}.", "",
          md_table(h["table"]), f"* {vl(h['skill_historical_vs_latest_known'], 'historical projection', 'latest known price')}",
          f"* {vl(h['skill_historical_vs_reference'], 'historical projection', 'reference × 1.05')}",
          f"* Its own displayed range covered {h['own_range']['coverage_pct']:.0f} % (mean width {h['own_range']['mean_width_pct_of_forecast']:.0f} % of the forecast; {h['own_range']['below_pct']:.0f} % fell below it).", "",
          "## Ranges: calibrated on one year pair, checked on the other (80 % nominal)", ""]
    for anc, out in R["ranges_cross_pair"].items():
        L += [f"**Anchor: {anc}**", "", md_table([{"scope": f"{nm} (all)", **v["overall"]} for nm, v in out.items()] +
                                                  [{"scope": f"{nm}, {b} days", **x} for nm, v in out.items() for b, x in v["by_band"].items()],
                                                  ["scope", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_start", "n"]), ""]
    p = R["policy"]
    L += ["## Pre-registered policy applied to these numbers", "", "| Rule | Result |", "|---|---|"]
    for a in ("reference_x1.05", "reference_x1.00"):
        v = p[f"{a}_replaces_latest_known"]
        L.append(f"| {a} replaces latest known price (CI low > 0 in both pairs) | **{'adopted' if v['adopted'] else 'not adopted'}** (P1 {v['P1']['skill_pct']:+.1f} %, CI {v['P1']['ci_low_pct']:+.1f}…{v['P1']['ci_high_pct']:+.1f}; P2 {v['P2']['skill_pct']:+.1f} %, CI {v['P2']['ci_low_pct']:+.1f}…{v['P2']['ci_high_pct']:+.1f}) |")
    for m, v in p["model_adjustment"].items():
        L.append(f"| {m} model adjustment (beats own anchor and latest known, CI low > 0) | **{'adopted' if v['adopted'] else 'not adopted'}** (vs anchor {v['vs_own_anchor']['skill_pct']:+.1f} %, CI {v['vs_own_anchor']['ci_low_pct']:+.1f}…{v['vs_own_anchor']['ci_high_pct']:+.1f}; vs latest known {v['vs_latest_known']['skill_pct']:+.1f} %, CI {v['vs_latest_known']['ci_low_pct']:+.1f}…{v['vs_latest_known']['ci_high_pct']:+.1f}) |")
    for a, ok in p["range_shown"].items():
        L.append(f"| a range around the {a} anchor is shown (≥ {MIN_COVERAGE:.0f} % coverage in both directions) | **{'yes' if ok else 'no'}** |")
    rec = p["recommendation"]
    L += ["", f"**Recommendation (not applied to production):** {rec['recommended_display']}", "",
          f"Frozen in `phaseB_projection_decision.json` (sha256 `{r['decision_hash']}`).", "",
          "## Limitations", "",
          "* Only two year pairs exist, and the model comparison exists for one of them (P2). A different pair of years could rank the methods differently.",
          "* P2 covers origins January–June 2025 AND only targets before 1 July 2025, so no confirmation-period price is touched; this drops long horizons for May–June origins.",
          "* In P1 the simulated user's records end 31 Dec 2023 and the 2023 history is short (first 30 days cannot be origins).",
          "* Trailing-12-month growth needs two full years, so it exists only for P2.",
          "* The historical projection is scored on a random subset of P2 because its range needs a per-case weekly resample.",
          "* Nothing here changes production; the recommendation is for how a future version could present the result."]
    return "\n".join(L)


if __name__ == "__main__":
    main()
