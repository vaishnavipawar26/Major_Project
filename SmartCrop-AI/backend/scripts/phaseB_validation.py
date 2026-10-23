"""Phase B, Stage A: validation-only experiments (Tasks 2 and 3). NO confirmation (2025-H2) cases are built.

Run from backend/:   python -m scripts.phaseB_validation        (EVAL_SMOKE=1 = tiny code-path check)

Two chronological validation folds (all fits use only pairs whose TARGET date is before the cut):
  fold C  cut 2024-07-01, validation origins 2024-07..12     (18 months of training data)
  fold A  cut 2025-01-01, validation origins 2025-01..06
Every variant uses the same training pairs, the same validation cases, the production architecture and
the production horizon->model assignment (200k pairs; random forests capped at 100k rows for speed).
Shrinkage weights are evaluated CROSS-FOLD (weights chosen on the other fold) so a validation number is
never scored with weights tuned on the same cases. Output: dataset/reports/phaseB_validation.md/.json
and phaseB_decisions.json (frozen; Stage B must not change it).
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import MODEL_FEATURES
from scripts.backtest_candidate_v2 import (W_GRID, choose_w, conformal_q, cov_block, typical_error)
from scripts.backtest_price import BANDS, clean, md_table, metrics, paired_boot
from scripts.phaseB_common import (GROUP_MEMBERS, NEW_FEATURES, X2_of, cases_frame, content_hash,
                                   fit_models, predict_all, prepare, variant_table)
from scripts.train_price_model import sample

SMOKE = os.getenv("EVAL_SMOKE") == "1"
OUT_DIR = Path(os.getenv("EVAL_OUT_DIR", paths.REPORTS_DIR))
N_TRAIN = 20_000 if SMOKE else 200_000
N_VAL = 3_000 if SMOKE else 100_000
N_CROP_TRAIN = 10_000 if SMOKE else 100_000
SEED = 11
FOLDS = {"C": (np.datetime64("2024-07-01"), np.datetime64("2024-07-01"), np.datetime64("2024-12-31")),
         "A": (np.datetime64("2025-01-01"), np.datetime64("2025-01-01"), np.datetime64("2025-06-30"))}
CONFIRMATION_START = np.datetime64("2025-07-01")
MIN_GAIN_PCT = 0.5          # a feature / group must improve pooled MAE by this much in BOTH folds
MAX_CROP_LOSS_PCT = 2.0     # ... and no crop may get worse by more than this in either fold
MIN_STRATEGY_GAIN_PCT = 0.5 # a model strategy must beat no-change by this much on average, and be >= 0 in both folds
MIN_CROP_CASES = 100 if SMOKE else 1500
CROP_MODEL_CROPS = ("Onion", "Wheat")
CRITERIA = {
    "feature_or_group_supported_if": f"pooled raw-MAE gain >= {MIN_GAIN_PCT}% in BOTH validation folds AND no crop (n >= {MIN_CROP_CASES}) worse than -{MAX_CROP_LOSS_PCT}% in either fold",
    "crop_strategy_adopted_if": f"cross-fold skill vs no-change >= 0 in both folds AND mean >= {MIN_STRATEGY_GAIN_PCT}%; otherwise the crop falls back to no-change",
    "eligible_strategies": ["shrink (final features)", "no_change", "v1_features + shrink", "crop-specific model (Onion/Wheat only)"],
    "informational_only": "validation gate (selected on both folds, so its numbers are optimistic)",
}


def main() -> None:
    t0 = time.time()
    log = lambda s: print(f"[{time.time() - t0:5.0f}s] {s}", flush=True)   # noqa: E731
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    c = prepare(log)
    variants = variant_table()
    crops = c.crops
    F: dict[str, SimpleNamespace] = {}

    # ------------------------------------------------------------------ fits and validation predictions
    for fname, (cut, vs, ve) in FOLDS.items():
        assert ve < CONFIRMATION_START, "Stage A must not touch the confirmation period"
        rng = np.random.default_rng(SEED + (fname == "A"))
        tr = sample(rng, c.has_target & (c.pair_target < cut), N_TRAIN)
        assert c.pair_target[tr].max() < cut, "training target date leaks past the cut-off"
        Xtr, ytr = X2_of(c, tr), c.y_all[tr]
        vidx = sample(rng, c.defined & (c.pair_origin >= vs) & (c.pair_origin <= ve), N_VAL)
        cases = cases_frame(c, vidx)
        assert cases["origin"].max() < CONFIRMATION_START
        Xv = X2_of(c, vidx)
        preds = {}
        for name, v in variants.items():
            preds[name] = predict_all(c, fit_models(c, Xtr, ytr, v["cols"]), Xv[v["cols"]]).astype(float)
            log(f"fold {fname} variant {name}: fitted on {len(tr):,} pairs (targets < {cut}), scored {len(cases):,} validation cases")
        F[fname] = SimpleNamespace(name=fname, cut=cut, tr=tr, Xtr=Xtr, ytr=ytr, cases=cases, Xv=Xv, preds=preds,
                                   actual=(cases["p0"] * np.exp(cases["y"])).to_numpy(),
                                   week=pd.to_datetime(cases["origin"]).dt.to_period("W").astype(str).to_numpy(),
                                   rng=np.random.default_rng(SEED + 100 + (fname == "A")))
    rboot = np.random.default_rng(SEED + 999)

    def err(k, pred):
        f = F[k]
        return np.abs(f.cases["p0"].to_numpy() * np.exp(pred) - f.actual)

    # ------------------------------------------------------------------ Task 3: feature value
    def compare(k, with_name, without_name):
        f = F[k]
        em, eb = err(k, f.preds[with_name]), err(k, f.preds[without_name])
        out = paired_boot(em, eb, f.week, rboot)
        crop_sk = {}
        for ci in sorted(f.cases["crop"].unique()):
            m = (f.cases["crop"] == ci).to_numpy()
            if m.sum() >= MIN_CROP_CASES:
                crop_sk[crops[ci]] = float((1 - em[m].sum() / eb[m].sum()) * 100)
        out["crop_skill_pct"] = crop_sk
        out["worst_crop"] = min(crop_sk, key=crop_sk.get) if crop_sk else None
        out["worst_crop_skill_pct"] = min(crop_sk.values()) if crop_sk else None
        return out

    feat_rows, verdicts = [], {}
    for name, v in variants.items():
        for k in F:
            m = metrics(F[k].cases["p0"].to_numpy(), F[k].cases["y"].to_numpy(), F[k].preds[name])
            feat_rows.append({"variant": name, "fold": k, "n": m["n"], "MAE": m["MAE"], "WAPE_pct": m["WAPE_pct"],
                              "direction_acc_pct": m["direction_acc_pct"], "n_meaningful": m["n_meaningful"],
                              "up_share_pct": m["up_share_of_meaningful_pct"]})
    pairs = {"v2": ("v2", "v1")}
    pairs.update({n: (n, "v1") for n, v in variants.items() if v["kind"] == "add-on"})
    pairs.update({n: ("v2", n) for n, v in variants.items() if v["kind"] == "drop-out"})
    for name, (w_, wo_) in pairs.items():
        cmp_ = {k: compare(k, w_, wo_) for k in F}
        ok = all(cmp_[k]["skill_pct"] >= MIN_GAIN_PCT for k in F) and all(
            (cmp_[k]["worst_crop_skill_pct"] is None or cmp_[k]["worst_crop_skill_pct"] >= -MAX_CROP_LOSS_PCT) for k in F)
        verdicts[name] = {"with": w_, "without": wo_, "kind": variants[name]["kind"], "supported": bool(ok), "folds": cmp_,
                          "ci_excludes_zero_in_both": bool(all(cmp_[k]["ci_low_pct"] > 0 for k in F))}
        log(f"verdict {name}: {'SUPPORTED' if ok else 'not supported'} "
            + ", ".join(f"{k} {cmp_[k]['skill_pct']:+.2f}%" for k in F))

    # ------------------------------------------------------------------ final feature set (frozen rule)
    adds = [f for f in NEW_FEATURES if verdicts[f"add_{f}"]["supported"]]
    final_cols = list(MODEL_FEATURES) + adds
    if not adds:
        final_name = "v1"
    elif len(adds) == len(NEW_FEATURES):
        final_name = "v2"
    elif len(adds) == 1:
        final_name = f"add_{adds[0]}"
    else:
        final_name = "final_combo"
        for k, f in F.items():
            f.preds[final_name] = predict_all(c, fit_models(c, f.Xtr, f.ytr, final_cols), f.Xv[final_cols]).astype(float)
            log(f"fold {k} extra variant final_combo fitted ({len(adds)} supported add-ons)")
    log(f"final feature set: {final_name} = v1 + {adds}")

    # ------------------------------------------------------------------ cross-fold shrinkage helpers
    folds = list(F)
    other = {folds[0]: folds[1], folds[1]: folds[0]}

    def W_of(k, pred, mask=None):
        f = F[k]
        m = np.ones(len(f.cases), bool) if mask is None else mask
        return choose_w(f.cases["crop"].to_numpy()[m], f.cases["band"].to_numpy()[m], f.cases["p0"].to_numpy()[m],
                        pred[m], f.actual[m], c.n_crops)

    def shrunk(k, name_pred_by_fold, crop_mask_by_fold=None):
        """name_pred_by_fold: {fold: raw pred array}. Weights for fold k come from the other fold."""
        out = {}
        for kk in folds:
            j = other[kk]
            mj = None if crop_mask_by_fold is None else crop_mask_by_fold[j]
            W = W_of(j, name_pred_by_fold[j], mj)
            cj = F[kk].cases
            out[kk] = W[cj["crop"].to_numpy(), cj["band"].to_numpy()] * name_pred_by_fold[kk]
        return out

    # cross-fold shrinkage for every variant (secondary view of the feature results)
    shr_rows = []
    for name in list(variants) + ([final_name] if final_name == "final_combo" else []):
        sp = shrunk(None, {k: F[k].preds[name] for k in folds})
        for k in folds:
            em, en = err(k, sp[k]), err(k, np.zeros(len(F[k].cases)))
            shr_rows.append({"variant": name, "fold": k, "MAE_cross_shrunk": float(em.mean()), "MAE_no_change": float(en.mean()),
                             "skill_vs_no_change_pct": float((1 - em.sum() / en.sum()) * 100)})

    # ------------------------------------------------------------------ feature coverage
    cov_rows = []
    for k in folds:
        f = F[k]
        for ci in sorted(f.cases["crop"].unique()):
            m = (f.cases["crop"] == ci).to_numpy()
            row = {"fold": k, "crop": crops[ci], "n": int(m.sum())}
            for feat_ in NEW_FEATURES:
                row[feat_] = float(f.Xv[feat_].notna().to_numpy()[m].mean() * 100)
            cov_rows.append(row)
    strat = {}
    for k in folds:
        f = F[k]
        avail = (f.Xv["arr_vs_month_prior"].notna() & f.Xv["season_change"].notna() & f.Xv["yoy_gap"].notna()).to_numpy()
        e2, e1 = err(k, f.preds["v2"]), err(k, f.preds["v1"])
        strat[k] = {"all_three_available": {"n": int(avail.sum()), "v2_vs_v1_skill_pct": float((1 - e2[avail].sum() / e1[avail].sum()) * 100) if avail.any() else None},
                    "some_missing": {"n": int((~avail).sum()), "v2_vs_v1_skill_pct": float((1 - e2[~avail].sum() / e1[~avail].sum()) * 100) if (~avail).any() else None}}

    # ------------------------------------------------------------------ Task 2: per-crop strategies
    fin = {k: F[k].preds[final_name] for k in folds}
    v1p = {k: F[k].preds["v1"] for k in folds}
    sh_final = shrunk(None, fin)
    sh_v1 = shrunk(None, v1p)
    cropmodel = {}
    for cname in CROP_MODEL_CROPS:
        ci = c.encoders["commodity"][cname]
        pred_by_fold = {}
        for k in folds:
            f = F[k]
            rng = np.random.default_rng(SEED + 500 + ci + (k == "A"))
            tr = sample(rng, c.has_target & (c.crop_code[c.oi] == ci) & (c.pair_target < f.cut), N_CROP_TRAIN)
            assert c.pair_target[tr].max() < f.cut
            models = fit_models(c, X2_of(c, tr), c.y_all[tr], final_cols)
            m = (f.cases["crop"] == ci).to_numpy()
            p = np.zeros(len(f.cases))
            p[m] = predict_all(c, models, f.Xv.loc[m, final_cols]).astype(float)
            pred_by_fold[k] = p
            log(f"crop-specific model {cname} fold {k}: {len(tr):,} pairs")
        cropmodel[cname] = pred_by_fold

    def crop_skill(k, ci, shrunk_pred):
        m = (F[k].cases["crop"] == ci).to_numpy()
        e, en = err(k, shrunk_pred)[m], err(k, np.zeros(len(F[k].cases)))[m]
        return float((1 - e.sum() / en.sum()) * 100), int(m.sum())

    strat_rows, chosen = [], {}
    for ci, cname in enumerate(crops):
        cand = {"no_change": {k: (0.0, int((F[k].cases["crop"] == ci).sum())) for k in folds},
                "shrink (final features)": {k: crop_skill(k, ci, sh_final[k]) for k in folds},
                "v1_features + shrink": {k: crop_skill(k, ci, sh_v1[k]) for k in folds}}
        if cname in CROP_MODEL_CROPS:
            cm_masks = {k: (F[k].cases["crop"] == ci).to_numpy() for k in folds}
            sp = shrunk(None, cropmodel[cname], cm_masks)
            cand["crop-specific model + shrink"] = {k: crop_skill(k, ci, sp[k]) for k in folds}
        # informational: validation gate on the final model (selected on both folds -> optimistic)
        gate = {}
        for k in folds:
            f = F[k]
            pred = sh_final[k].copy()
            for b in range(4):
                passes = True
                for kk in folds:
                    mm = ((F[kk].cases["crop"] == ci) & (F[kk].cases["band"] == b)).to_numpy()
                    if mm.sum() and err(kk, sh_final[kk])[mm].sum() > err(kk, np.zeros(len(F[kk].cases)))[mm].sum():
                        passes = False
                if not passes:
                    pred[((f.cases["crop"] == ci) & (f.cases["band"] == b)).to_numpy()] = 0.0
            gate[k] = crop_skill(k, ci, pred)
        for sname, vals in cand.items():
            strat_rows.append({"crop": cname, "strategy": sname, **{f"skill_{k}_pct": vals[k][0] for k in folds},
                               **{f"n_{k}": vals[k][1] for k in folds}, "mean_skill_pct": float(np.mean([vals[k][0] for k in folds]))})
        strat_rows.append({"crop": cname, "strategy": "validation gate (informational, optimistic)", **{f"skill_{k}_pct": gate[k][0] for k in folds},
                           **{f"n_{k}": gate[k][1] for k in folds}, "mean_skill_pct": float(np.mean([gate[k][0] for k in folds]))})
        best_name, best_mean = "no_change", 0.0
        for sname, vals in cand.items():
            mean_, mn = float(np.mean([vals[k][0] for k in folds])), min(vals[k][0] for k in folds)
            if sname != "no_change" and mn >= 0 and mean_ >= MIN_STRATEGY_GAIN_PCT and mean_ > best_mean:
                best_name, best_mean = sname, mean_
        chosen[cname] = {"strategy": best_name, "mean_cross_fold_skill_pct": best_mean,
                         "reason": ("model beats no-change in both folds" if best_name != "no_change" else
                                    "no eligible model strategy was >= 0% in both folds with a mean gain >= "
                                    f"{MIN_STRATEGY_GAIN_PCT}%: falls back to no-change")}
        log(f"crop {cname}: strategy -> {best_name}")

    # ------------------------------------------------------------------ Onion / Wheat diagnostics
    diag = {}
    for cname in CROP_MODEL_CROPS:
        ci = c.encoders["commodity"][cname]
        d = {}
        for k in folds:
            f, m = F[k], (F[k].cases["crop"] == ci).to_numpy()
            cs = f.cases[m].reset_index(drop=True)
            pred, p1 = fin[k][m], v1p[k][m]
            e_mod = err(k, fin[k])[m]
            e_nc = err(k, np.zeros(len(f.cases)))[m]
            worst = np.sort(e_mod)[::-1][: max(1, int(0.05 * len(e_mod)))].sum() / e_mod.sum() * 100
            by_band = {BANDS[b]: {"n": int((cs["band"] == b).sum()), "mean_signed_log_error": float((pred - cs["y"].to_numpy())[(cs["band"] == b).to_numpy()].mean()),
                                  "model_MAE": float(e_mod[(cs["band"] == b).to_numpy()].mean()), "no_change_MAE": float(e_nc[(cs["band"] == b).to_numpy()].mean())}
                       for b in range(4) if (cs["band"] == b).any()}
            by_var = {}
            for vname, g in cs.groupby("variety"):
                if len(g) >= max(50, MIN_CROP_CASES // 10):
                    ix = g.index.to_numpy()
                    by_var[vname] = {"n": int(len(ix)), "model_MAE": float(e_mod[ix].mean()), "no_change_MAE": float(e_nc[ix].mean())}
            d[k] = {"n": int(m.sum()), "share_of_error_from_worst_5pct_cases": float(worst),
                    "state_median_series_share_pct": float(cs["is_state"].mean() * 100),
                    "markets": int(cs["market"].nunique()), "weeks": int(pd.Series(f.week[m]).nunique()),
                    "start_or_target_day_outlier_capped_pct": float((cs["capped_origin"] | cs["capped_target"]).mean() * 100),
                    "model_MAE": float(e_mod.mean()), "no_change_MAE": float(e_nc.mean()),
                    "v1_MAE": float(err(k, v1p[k])[m].mean()),
                    "market_cluster_skill": paired_boot(e_mod, e_nc, cs["market"].to_numpy(), rboot),
                    "week_cluster_skill": paired_boot(e_mod, e_nc, f.week[m], rboot),
                    "by_band": by_band, "by_variety": by_var}
        diag[cname] = d

    # ------------------------------------------------------------------ final weights, intervals (pooled validation)
    def pooled(arrs):
        return np.concatenate([arrs[k] for k in folds])

    cases_all = pd.concat([F[k].cases for k in folds], ignore_index=True)
    actual_all = pooled({k: F[k].actual for k in folds})
    crop_all, band_all, p0_all = cases_all["crop"].to_numpy(), cases_all["band"].to_numpy(), cases_all["p0"].to_numpy()
    y_all = cases_all["y"].to_numpy()

    def strategy_raw(cname):
        s = chosen[cname]["strategy"]
        ci = c.encoders["commodity"][cname]
        if s == "no_change":
            return pooled({k: np.zeros(len(F[k].cases)) for k in folds})
        if s.startswith("v1_features"):
            return pooled(v1p)
        if s.startswith("crop-specific"):
            return pooled(cropmodel[cname])
        return pooled(fin)

    final_pred = np.zeros(len(cases_all))
    final_w = {}
    for ci, cname in enumerate(crops):
        m = crop_all == ci
        raw = strategy_raw(cname)
        if chosen[cname]["strategy"] == "no_change":
            W = np.zeros((c.n_crops, 4))
        else:
            W = choose_w(crop_all[m], band_all[m], p0_all[m], raw[m], actual_all[m], c.n_crops)
        final_w[cname] = {BANDS[b]: float(W[ci, b]) for b in range(4)}
        final_pred[m] = (W[ci, band_all[m]] * raw[m])
    resid = y_all - final_pred
    Q = conformal_q(crop_all, band_all, resid, c.n_crops)
    T = typical_error(crop_all, band_all, resid, c.n_crops)

    # cross-fold interval check: calibrate on one fold, evaluate on the other (final strategy, final weights)
    idxs = {k: np.flatnonzero((cases_all["origin"] >= np.datetime64(str(FOLDS[k][1]))).to_numpy() & (cases_all["origin"] <= np.datetime64(str(FOLDS[k][2]))).to_numpy()) for k in folds}
    cov_cross = {}
    for k in folds:
        j = other[k]
        Qj = conformal_q(crop_all[idxs[j]], band_all[idxs[j]], resid[idxs[j]], c.n_crops)
        lo, hi = Qj[crop_all[idxs[k]], band_all[idxs[k]], 0], Qj[crop_all[idxs[k]], band_all[idxs[k]], 1]
        yk, pk = y_all[idxs[k]], final_pred[idxs[k]]
        cov_cross[f"calibrate {j} -> evaluate {k}"] = {
            "overall": cov_block(yk, pk, lo, hi),
            "by_band": {BANDS[b]: cov_block(yk, pk, lo, hi, band_all[idxs[k]] == b) for b in range(4)},
            "by_crop": {crops[ci]: cov_block(yk, pk, lo, hi, crop_all[idxs[k]] == ci) for ci in sorted(set(crop_all[idxs[k]]))}}

    # overall effect of the per-crop strategy choice vs the simple "shrink everywhere" candidate (cross-fold)
    pooled_check = {}
    for k in folds:
        m_all = np.ones(len(F[k].cases), bool)
        base_e = err(k, sh_final[k])
        nc = err(k, np.zeros(len(F[k].cases)))
        chosen_pred = np.zeros(len(F[k].cases))
        for ci, cname in enumerate(crops):
            m = (F[k].cases["crop"] == ci).to_numpy()
            s = chosen[cname]["strategy"]
            chosen_pred[m] = {"no_change": np.zeros(len(F[k].cases)), "v1_features + shrink": sh_v1[k],
                              "crop-specific model + shrink": shrunk(None, cropmodel[cname], {kk: (F[kk].cases["crop"] == ci).to_numpy() for kk in folds})[k]
                              if cname in cropmodel else sh_final[k]}.get(s, sh_final[k])[m]
        ce = err(k, chosen_pred)
        pooled_check[k] = {"skill_shrink_everywhere_pct": float((1 - base_e.sum() / nc.sum()) * 100),
                           "skill_with_crop_strategies_pct": float((1 - ce.sum() / nc.sum()) * 100)}
        pooled_check[k]["change_points"] = pooled_check[k]["skill_with_crop_strategies_pct"] - pooled_check[k]["skill_shrink_everywhere_pct"]

    # ------------------------------------------------------------------ frozen decisions
    decisions = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "smoke_run": SMOKE,
        "status": "FROZEN after Stage A. Stage B must load this file, verify content_sha256 and change nothing.",
        "criteria": CRITERIA, "validation_folds": {k: {"train_targets_before": str(FOLDS[k][0]), "validation_origins": f"{FOLDS[k][1]} .. {FOLDS[k][2]}"} for k in folds},
        "features": {"final_variant": final_name, "final_columns": final_cols, "supported_new_features": adds,
                     "verdicts": {n: {"supported": v["supported"], "kind": v["kind"], "with": v["with"], "without": v["without"],
                                      **{f"gain_pct_fold_{k}": v["folds"][k]["skill_pct"] for k in folds},
                                      **{f"ci_fold_{k}": [v["folds"][k]["ci_low_pct"], v["folds"][k]["ci_high_pct"]] for k in folds},
                                      **{f"worst_crop_fold_{k}": [v["folds"][k]["worst_crop"], v["folds"][k]["worst_crop_skill_pct"]] for k in folds}}
                                  for n, v in verdicts.items()}},
        "crop_strategy": chosen, "shrink_weights": final_w, "w_grid": W_GRID.tolist(),
        "conformal_q_log": {crops[ci]: {BANDS[b]: Q[ci, b].tolist() for b in range(4)} for ci in range(len(crops))},
        "typical_error_log": {crops[ci]: {BANDS[b]: float(T[ci, b]) for b in range(4)} for ci in range(len(crops))},
        "conformal_alpha": 0.2, "interval_calibration_data": "pooled validation folds C and A (final strategy residuals)",
        "stage_B_plan": ["load these decisions and verify the hash", "fit the chosen models on targets < 2025-07-01 (fit B)",
                         "score the 2025-H2 confirmation cases ONCE with the frozen features, strategies, weights and conformal bands",
                         "rebuild reliability counts and regenerate six samples with explain_v3 (no setting changes)"],
    }
    decisions["content_sha256"] = content_hash({k: v for k, v in decisions.items() if k not in ("created", "content_sha256")})
    (OUT_DIR / "phaseB_decisions.json").write_text(json.dumps(clean(decisions), indent=2), encoding="utf-8")

    result = {"created": decisions["created"], "smoke_run": SMOKE, "criteria": CRITERIA,
              "n_validation": {k: len(F[k].cases) for k in folds}, "n_train_pairs": N_TRAIN,
              "variant_rows": feat_rows, "verdicts": verdicts, "cross_shrunk_rows": shr_rows,
              "coverage_rows": cov_rows, "stratified_v2_vs_v1": strat, "strategy_rows": strat_rows,
              "diagnostics": diag, "interval_cross_fold": cov_cross, "pooled_effect_of_crop_strategies": pooled_check,
              "final_variant": final_name, "decisions_hash": decisions["content_sha256"]}
    (OUT_DIR / "phaseB_validation.json").write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
    (OUT_DIR / "phaseB_validation.md").write_text(render(result, decisions, crops), encoding="utf-8")
    log(f"done; reports in {OUT_DIR}")


# ----------------------------------------------------------------------------- report
def render(r, dec, crops) -> str:
    folds = list(r["n_validation"])
    L = [f"# Phase B Stage A: validation-only results ({'SMOKE RUN – meaningless numbers' if r['smoke_run'] else 'final'})", "",
         f"Generated {r['created']}. Validation folds: " + "; ".join(f"**{k}** = train targets < {v['train_targets_before']}, validate origins {v['validation_origins']} (n = {r['n_validation'][k]:,})" for k, v in dec["validation_folds"].items())
         + f". Training pairs per fit: {r['n_train_pairs']:,}. **No 2025-H2 confirmation case was built or scored.** ₹/quintal.", "",
         "## 0. Summary", ""]
    sup = [f for f in NEW_FEATURES if r["verdicts"][f"add_{f}"]["supported"]]
    L.append(f"* New features supported by BOTH folds (as individual add-ons to the production features): **{', '.join(sup) or 'none'}**. "
             f"Frozen final feature set: **{r['final_variant']}**.")
    L.append("* Not supported: " + (", ".join(f for f in NEW_FEATURES if f not in sup) or "none") + ".")
    L.append("* Crop strategies (frozen): " + "; ".join(f"{c}: {v['strategy']}" for c, v in dec["crop_strategy"].items()) + ".")
    L += ["", "## 1. Acceptance criteria (fixed before running)", ""] + [f"* **{k}:** {v if isinstance(v, str) else ', '.join(v)}" for k, v in r["criteria"].items()] + [""]

    L += ["## 2. Task 3: value of each feature / group (raw model output, no shrinkage)", "",
          "MAE, WAPE and direction accuracy (moves above 5 %) per variant and fold on identical validation cases:", "",
          md_table(r["variant_rows"], ["variant", "fold", "n", "MAE", "WAPE_pct", "direction_acc_pct", "n_meaningful", "up_share_pct"]), "",
          "**Verdicts** (gain = 1 − MAE_with / MAE_without; 95 % interval from resampling origin weeks; worst crop = largest loss among crops):", ""]
    rows = []
    for n, v in r["verdicts"].items():
        row = {"variant": n, "compared": f"{v['with']} vs {v['without']}", "verdict": "SUPPORTED" if v["supported"] else "not supported"}
        for k in folds:
            f = v["folds"][k]
            row[f"gain % ({k})"] = f["skill_pct"]
            row[f"CI ({k})"] = f"{f['ci_low_pct']:+.1f}…{f['ci_high_pct']:+.1f}"
            row[f"worst crop ({k})"] = f"{f['worst_crop']} {f['worst_crop_skill_pct']:+.1f}%" if f["worst_crop"] else "–"
        row["CI excludes 0 in both"] = v["ci_excludes_zero_in_both"]
        rows.append(row)
    L += [md_table(rows), "",
          "Reading: an add-on row compares v1 + that feature with v1; a drop-out row compares the full v2 with v2 minus the whole group "
          "(so a supported drop-out means the group as a whole earns its place, not that the new feature inside it does). "
          "'Supported' requires the point-estimate criteria above; the interval column shows whether the gain is also statistically clear.", "",
          "**Same variants after cross-fold shrinkage** (weights from the other fold):", "",
          md_table(r["cross_shrunk_rows"], ["variant", "fold", "MAE_cross_shrunk", "MAE_no_change", "skill_vs_no_change_pct"]), ""]

    L += ["## 3. Feature coverage (share of validation cases where the feature has a value)", "",
          md_table(r["coverage_rows"], ["fold", "crop", "n", *NEW_FEATURES]), "",
          "Why coverage is thin: the first data year (2023) has no earlier year, so `arr_vs_month_prior`, `season_change` and `yoy_gap` are missing there, and `lag_90_change` needs 90 days of history. "
          "Fold C (origins in 2024-H2) has only one earlier year; fold A has two for seasonal / arrivals comparisons.", "",
          "**v2 versus v1 where the time-dependent features exist and where they do not:**", ""]
    for k, s in r["stratified_v2_vs_v1"].items():
        a, b = s["all_three_available"], s["some_missing"]
        L.append(f"* fold {k}: all three available n = {a['n']:,}, v2 gain over v1 = {('%+.2f' % a['v2_vs_v1_skill_pct']) + ' %' if a['v2_vs_v1_skill_pct'] is not None else '–'}; "
                 f"some missing n = {b['n']:,}, gain = {('%+.2f' % b['v2_vs_v1_skill_pct']) + ' %' if b['v2_vs_v1_skill_pct'] is not None else '–'}.")
    L.append("")

    L += ["## 4. Task 2: crop strategies (skill vs no-change, cross-fold: weights chosen on the other fold)", "",
          md_table(r["strategy_rows"], ["crop", "strategy", *[f"skill_{k}_pct" for k in folds], *[f"n_{k}" for k in folds], "mean_skill_pct"]), "",
          "**Frozen choice per crop**", "", md_table([{"crop": c, "strategy": v["strategy"], "mean cross-fold skill %": v["mean_cross_fold_skill_pct"], "reason": v["reason"]} for c, v in dec["crop_strategy"].items()]), "",
          "**Pooled effect of the per-crop choices** (cross-fold, skill vs no-change over all crops):", "",
          md_table([{"fold": k, **v} for k, v in r["pooled_effect_of_crop_strategies"].items()]), "",
          "The validation-gate row is informational only: the gate is selected using both folds, so its numbers are optimistic and it is not eligible for adoption.", ""]
    for cname, d in r["diagnostics"].items():
        L += [f"### Diagnostics: {cname} (final features, raw model output)", ""]
        rows = [{"fold": k, "n": v["n"], "markets": v["markets"], "weeks": v["weeks"], "model MAE": v["model_MAE"], "v1 MAE": v["v1_MAE"], "no-change MAE": v["no_change_MAE"],
                 "skill (week CI)": f"{v['week_cluster_skill']['skill_pct']:+.1f} ({v['week_cluster_skill']['ci_low_pct']:+.1f}…{v['week_cluster_skill']['ci_high_pct']:+.1f})",
                 "skill (market CI)": f"{v['market_cluster_skill']['skill_pct']:+.1f} ({v['market_cluster_skill']['ci_low_pct']:+.1f}…{v['market_cluster_skill']['ci_high_pct']:+.1f})",
                 "error from worst 5 % cases %": v["share_of_error_from_worst_5pct_cases"], "state-median series %": v["state_median_series_share_pct"],
                 "outlier-capped day %": v["start_or_target_day_outlier_capped_pct"]} for k, v in d.items()]
        L += [md_table(rows), "Signed error (model − actual, log) and MAE by band:", ""]
        rows = [{"fold": k, "band": b, **x} for k, v in d.items() for b, x in v["by_band"].items()]
        L += [md_table(rows), "By variety:", ""]
        rows = [{"fold": k, "variety": vn, **x} for k, v in d.items() for vn, x in v["by_variety"].items()]
        L += [md_table(rows), ""]

    L += ["## 5. Prediction ranges, calibrated on one fold and checked on the other (final strategy, 80 % nominal)", ""]
    for name, v in r["interval_cross_fold"].items():
        L += [f"**{name}**", "", md_table([{"scope": "all", **v["overall"]}, *[{"scope": f"{b} days", **x} for b, x in v["by_band"].items()],
                                          *[{"scope": cn, **x} for cn, x in v["by_crop"].items()]],
                                         ["scope", "coverage_pct", "below_pct", "above_pct", "mean_width_pct_of_start", "n"]), ""]

    L += ["## 6. Frozen decisions", "",
          f"`dataset/reports/phaseB_decisions.json` (sha256 `{r['decisions_hash']}`) holds the final features, per-crop strategy, shrinkage weights, conformal bands and typical errors. "
          "Stage B (not started) would: " + "; ".join(dec["stage_B_plan"]) + ".", "",
          "**Shrinkage weights (pooled validation):**", "", md_table([{"crop": c, **v} for c, v in dec["shrink_weights"].items()]), ""]
    L += ["## 7. Limitations", "",
          "* Three years of data. Fold C trains on only 18 months and has one earlier year for the seasonal / arrivals / year-ago features, so it is a harder, thinner validation than fold A.",
          "* Both folds are consecutive half-years of the same period (2024-H2, 2025-H1); a feature that helps in both may still not help in other years.",
          "* Models are re-fitted with 200k pairs (random forests capped at 100k rows); absolute MAEs differ slightly from Phase 2, so only within-report comparisons are valid.",
          "* Crop-strategy numbers are cross-fold, but the feature set and the strategy rule were chosen on the same two folds; Stage B is the first genuinely held-out check, and 2025-H2 was already seen in Phase 2.",
          "* Market series and the state-median series are correlated; the market-clustered intervals in section 4 are the more conservative ones.",
          "* Arrivals have no stated unit; nearby-market and weather information are not used."]
    return "\n".join(L)


if __name__ == "__main__":
    main()
