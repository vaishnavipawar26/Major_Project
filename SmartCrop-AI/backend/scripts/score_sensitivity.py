"""How sensitive is the top-3 ranking to the score weights?

Run from backend/:  python -m scripts.score_sensitivity

Uses a sample of rows of the recommendation dataset as input profiles (with their own city,
planting and selling month), scores all crops once, then re-ranks with alternative weightings
and compares the top-3 against the default weights.
Writes trained_models/crop_recommendation/weight_sensitivity.json.
"""
from __future__ import annotations

import json
from datetime import date

import pandas as pd

from app.ml.common import paths
from app.ml.crop_recommendation.recommender import TOP_N, WEIGHTS, CropRecommender
from app.ml.price_prediction.monthly_forecaster import MonthlyPriceForecaster

SAMPLE = 300
ALTERNATIVES = {
    "suitability_heavy": {"agronomic": 0.60, "timing": 0.20, "profit": 0.20},
    "profit_heavy": {"agronomic": 0.30, "timing": 0.10, "profit": 0.60},
    "equal_thirds": {"agronomic": 1 / 3, "timing": 1 / 3, "profit": 1 / 3},
    "no_timing": {"agronomic": 0.50, "timing": 0.0, "profit": 0.50},
}


def top(results: list[dict], w: dict) -> list[str]:
    scored = sorted(results, key=lambda r: (r["eligible"], w["agronomic"] * r["agronomic_score"]
                                            + w["timing"] * r["timing_score"]
                                            + w["profit"] * r["profit_score"]), reverse=True)
    return [r["crop_name"] for r in scored[:TOP_N] if r["eligible"]]


def main() -> None:
    rec = CropRecommender(MonthlyPriceForecaster())
    df = pd.read_csv(paths.REC_DATASET_PATH).sample(SAMPLE, random_state=0)
    runs = []
    for r in df.itertuples():
        inputs = {k: getattr(r, k) for k in ("N", "P", "K", "temperature", "humidity", "ph",
                                             "rainfall")}
        out = rec.analyze(inputs, r.city, int(r.planting_month), int(r.selling_month),
                          today=date(2026, 10, 1))
        runs.append((r.label, out["results"]))

    base = [top(res, WEIGHTS) for _, res in runs]
    report = {"profiles": len(runs), "default_weights": WEIGHTS,
              "label_in_default_top3_pct": round(100 * sum(lbl in b for (lbl, _), b
                                                           in zip(runs, base)) / len(runs), 1),
              "alternatives": {}}
    for name, w in ALTERNATIVES.items():
        alt = [top(res, w) for _, res in runs]
        report["alternatives"][name] = {
            "weights": w,
            "same_top1_pct": round(100 * sum(a[:1] == b[:1] for a, b in zip(alt, base)) / len(runs), 1),
            "same_top3_set_pct": round(100 * sum(set(a) == set(b) for a, b in zip(alt, base)) / len(runs), 1),
        }
    out = paths.REC_MODEL_DIR / "weight_sensitivity.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
