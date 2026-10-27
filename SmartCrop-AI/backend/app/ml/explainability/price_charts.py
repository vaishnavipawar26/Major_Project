"""Chart data for the price explanation page, built only from the model's own SHAP output.

Two different things are produced and must not be confused:

* ``local``  - how THIS forecast was built: the starting price, the model's baseline shift and the
  push of each factor group, in rupees per quintal, ending at the model's forecast. Taken from the
  SHAP values of this one forecast (exact TreeExplainer), which add up to the model output in log space.
* ``global`` - which factors matter most to the model IN GENERAL: the mean |SHAP| stored at training
  time (2,000 recent forecasts), summed per factor group. It says nothing about this forecast.

Rupee values: the model's base price is ``start * exp(base)`` and the forecast is ``start * exp(base + sum of SHAP)``.
The difference is shared between the factor groups in proportion to their SHAP values, so base price plus all
contributions equals the forecast exactly, whatever the order, and each bar keeps the sign of its SHAP value.
"""
from __future__ import annotations

import math

import numpy as np

from app.ml.explainability.price_explainer import FACTOR_GROUPS, FACTOR_TITLES

# What each group means, in words a farmer can use. Descriptions only: no numbers.
GROUP_HELP = {
    "recent_week": "How the price moved in the last few days.",
    "recent_month": "How the price moved over the last two to four weeks.",
    "averages": "Whether today's price is above or below its recent average.",
    "volatility": "How much the price jumps around from day to day.",
    "arrivals": "How much produce reached the market, compared with usual.",
    "state_market": "How this market's price compares with other Maharashtra markets.",
    "season": "The time of year of the forecast start and the selling date.",
    "distance": "How many days ahead the selling date is.",
    "price_level": "The current price itself: the starting point for the forecast.",
    "crop_market": "The usual price behaviour of this crop at this market.",
}
USED_GROUPS = [g for g in FACTOR_GROUPS if g != "weather"]   # weather is not an input of the deployed model
RECON_TOL = 0.5   # rupees: the chart must end within this of the forecast shown elsewhere


def _title(group: str) -> str:
    return FACTOR_TITLES[group]


def local_waterfall(shap_row: np.ndarray, base: float, feature_names: list[str],
                    start_price: float, forecast_price: float) -> dict | None:
    """Rupee waterfall from the starting price to the forecast; None when it cannot be built honestly."""
    contrib = dict(zip(feature_names, (float(v) for v in shap_row)))
    if not (start_price and start_price > 0) or not all(math.isfinite(v) for v in contrib.values()):
        return None
    sums = {g: sum(contrib.get(f, 0.0) for f in FACTOR_GROUPS[g]) for g in USED_GROUPS}
    covered = {f for g in USED_GROUPS for f in FACTOR_GROUPS[g]}
    if any(f not in covered for f in contrib):   # an input without a group would make the chart not add up
        return None
    order = sorted(sums, key=lambda g: -abs(sums[g]))
    total = sum(sums.values())
    baseline_price = start_price * math.exp(base)
    end_price = start_price * math.exp(base + total)
    # Rupee size of each factor: the move from the baseline price to the end price is shared in proportion to the
    # factors' SHAP sizes. This does not depend on any order and adds up exactly; every share keeps its SHAP sign
    # (end - baseline always has the same sign as the SHAP total, so the scale below is positive).
    k = (end_price - baseline_price) / total if abs(total) > 1e-9 else baseline_price
    steps = [{"group": g, "title": _title(g), "help": GROUP_HELP[g], "log_contribution": round(sums[g], 6),
              "inr": round(sums[g] * k, 2), "direction": "up" if sums[g] >= 0 else "down",
              "features": [f for f in FACTOR_GROUPS[g] if f in contrib]} for g in order]
    return {"start_price": round(start_price, 2),
            "baseline_inr": round(baseline_price - start_price, 2),
            "baseline_price": round(baseline_price, 2),
            "end_price": round(end_price, 2), "forecast_price": round(float(forecast_price), 2),
            "matches_forecast": abs(end_price - forecast_price) <= RECON_TOL,
            "steps": steps}


def global_importance(importance: dict[str, float] | None) -> dict | None:
    """Share of the model's average |SHAP| per factor group, from the importances saved at training."""
    if not importance:
        return None
    sums = {g: sum(importance.get(f, 0.0) for f in FACTOR_GROUPS[g]) for g in USED_GROUPS}
    total = sum(sums.values())
    if total <= 0:
        return None
    rows = [{"group": g, "title": _title(g), "help": GROUP_HELP[g], "mean_abs_log": round(v, 5),
             "share_pct": round(100 * v / total, 1)} for g, v in sums.items()]
    rows.sort(key=lambda r: -r["share_pct"])
    return {"method": "mean |SHAP| over 2,000 sampled recent forecasts (saved when the model was trained)",
            "groups": rows}


def build_charts(shap_row: np.ndarray, base: float, feature_names: list[str], start_price: float,
                 forecast_price: float, importance: dict[str, float] | None) -> dict:
    return {"local": local_waterfall(shap_row, base, feature_names, start_price, forecast_price),
            "global": global_importance(importance)}
