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
    "profit_heavy": {"location": 0.10, "planting": 0.10, "selling": 0.10, "soil": 0.10, "weather": 0.10, "profit": 0.50},
    "equal_parts": {k: 1 / 6 for k in WEIGHTS},
    "field_heavy": {"location": 0.10, "planting": 0.15, "selling": 0.05, "soil": 0.25, "weather": 0.25, "profit": 0.20},
    "no_location": {"location": 0.0, "planting": 0.25, "selling": 0.10, "soil": 0.20, "weather": 0.20, "profit": 0.25},
}


def top(results: list[dict], w: dict) -> list[str]:
    """Top-3 eligible crops when the six score parts (weighted points / default weight = 0-100 score) are re-weighted."""
    def score(r):
        return sum(w[k] * r["score_points"][k] / WEIGHTS[k] for k in WEIGHTS)
    scored = sorted(results, key=lambda r: (r["eligible"], score(r)), reverse=True)
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
