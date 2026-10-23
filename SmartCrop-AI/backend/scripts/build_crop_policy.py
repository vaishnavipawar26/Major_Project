"""Per crop x horizon-band policy: "model" or "context_only" (the model is not used to claim a rise or fall).

Run from backend/:   python -m scripts.build_crop_policy

Rule (applied to every cell, no hand-picked exceptions): a cell is CONTEXT-ONLY if any of
  1. the crop's frozen Phase B strategy is "no_change" (validation folds 2024-H2 and 2025-H1: the model was not >= 0 on both),
  2. the real-origin backtest (origins 2025-H2) shows the model does NOT beat "price stays unchanged" in that cell,
  3. the projection backtest shows the model does NOT beat the starting price in that cell.
Otherwise it is MODEL. The scenario-independent union is deliberate: the application falls back between the two
kinds of forecast depending on how old the records are, and a direction claim must hold in both.

Inputs : trained_models/price_reliability/reliability_v1.json (scripts.build_reliability_table),
         dataset/reports/phaseB_decisions.json and phaseB_validation.json (scripts.phaseB_validation)
Outputs: trained_models/price_reliability/crop_policy.json (read by the forecaster) and dataset/reports/crop_policy.md
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from app.ml.common import paths

BANDS = ["1-7", "8-14", "15-30", "31-60"]
CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]


def main() -> None:
    rel = json.loads((paths.MODELS_DIR / "price_reliability" / "reliability_v1.json").read_text(encoding="utf-8"))
    dec = json.loads((paths.REPORTS_DIR / "phaseB_decisions.json").read_text(encoding="utf-8"))
    val = json.loads((paths.REPORTS_DIR / "phaseB_validation.json").read_text(encoding="utf-8"))
    real, proj = rel["scenarios"]["real_origin"], rel["scenarios"]["projection"]
    strat_rows = {(r["crop"], r["strategy"]): r for r in val["strategy_rows"]}

    cells, table, no_change = {}, [], []
    for crop in CROPS:
        strategy = dec["crop_strategy"][crop]["strategy"]
        for band in BANDS:
            key = f"{crop}|{band}"
            reasons = []
            if strategy == "no_change":
                alt = strat_rows.get((crop, "shrink (final features)"))
                reasons.append("Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both"
                               + (f" (skill {alt['skill_C_pct']:+.1f}% / {alt['skill_A_pct']:+.1f}%)." if alt else "."))
            for name, sc, baseline in (("real-origin backtest", real, "no-change"), ("projection backtest", proj, "the starting price")):
                c = sc["cells"].get(key) or sc["crops"].get(crop)
                if c is None:
                    reasons.append(f"No {name} result exists for this cell.")
                elif not c["beats_baseline"]:
                    reasons.append(f"{name.capitalize()} (origins 2025-H2, n={c['n']:,}): model {c['skill_vs_baseline_pct']:+.1f}% vs {baseline}.")
            if crop == "Onion":
                d = val["diagnostics"]["Onion"]["A"]["market_cluster_skill"]
                reasons.append(f"Validation fold A (2025-H1), pooled model vs no-change: {d['skill_pct']:+.1f}% "
                               f"(market-bootstrap 95% CI {d['ci_low_pct']:+.1f} to {d['ci_high_pct']:+.1f}).")
            mode = "context_only" if reasons else "model"
            cells[key] = {"mode": mode, "reasons": reasons or ["The model beat its baseline in both backtests and was not rejected in validation."],
                          "real_origin_skill_pct": (real["cells"].get(key) or {}).get("skill_vs_baseline_pct"),
                          "projection_skill_pct": (proj["cells"].get(key) or {}).get("skill_vs_baseline_pct")}
            table.append((crop, band, mode, cells[key]))
        if all(cells[f"{crop}|{b}"]["mode"] == "context_only" for b in BANDS) and strategy == "no_change":
            no_change.append(crop)

    policy = {"created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rule": __doc__.split("Rule", 1)[1].split("Inputs", 1)[0].strip(),
              "reliability_created": rel["created"], "decisions_sha256": dec["content_sha256"], "no_change_crops": sorted(no_change),
              "context_only_cells": sorted(k for k, v in cells.items() if v["mode"] == "context_only"), "cells": cells}
    (paths.MODELS_DIR / "price_reliability" / "crop_policy.json").write_text(json.dumps(policy, indent=2), encoding="utf-8")

    L = ["# Crop × horizon-band policy: model or context-only", "",
         f"Generated {policy['created']} from the backtest reliability table and the frozen Phase B decisions. "
         "**Model** = the forecast and its ₹ explanation are shown. **Context-only** = no rise or fall is claimed; the dated records are shown for information.", "",
         "| Crop | Band (days) | Mode | Real-origin skill | Projection skill | Why |", "|---|---|---|---|---|---|"]
    for crop, band, mode, c in table:
        f = lambda v: "–" if v is None else f"{v:+.1f}%"   # noqa: E731
        L.append(f"| {crop} | {band} | **{mode.replace('_', '-')}** | {f(c['real_origin_skill_pct'])} | {f(c['projection_skill_pct'])} | {' '.join(c['reasons'])} |")
    (paths.REPORTS_DIR / "crop_policy.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    for crop in CROPS:
        print(f"{crop:12s}", "  ".join(f"{b}:{cells[f'{crop}|{b}']['mode'][:3]}" for b in BANDS))


if __name__ == "__main__":
    main()
