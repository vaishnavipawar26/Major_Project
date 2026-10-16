"""Turn SHAP values of the price model into farmer-friendly explanations.

The model predicts log(price[t+h] / price[t]); SHAP values are additive in that space.
A SHAP value s therefore corresponds to roughly (e^s - 1) x 100 % change in the forecast.
Related technical features (e.g. the calendar features) are grouped into one plain factor
so the farmer sees "seasonal pattern" instead of "doy_sin", "week_of_year", ...

The wording describes what the model *relied on* ("the model links this to a higher
predicted price"), never a proven cause: SHAP shows associations learned from past data.
"""
from __future__ import annotations

import math

import numpy as np

from app.ml.explainability.simple_factors import group_simple_factors

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]

# Farmer-facing factor -> technical features it aggregates
FACTOR_GROUPS = {
    "recent_week": ["lag_1_change", "lag_3_change", "lag_7_change", "pct_change_7"],
    "recent_month": ["lag_14_change", "lag_30_change"],
    "averages": ["roll_mean_7_gap", "roll_mean_14_gap", "roll_mean_30_gap", "momentum_7_30"],
    "volatility": ["volatility_30", "spread_ratio"],
    "arrivals": ["log_arrivals", "arrivals_vs_30d"],
    "state_market": ["state_price_gap", "state_change_7"],
    "season": ["month", "week_of_year", "day_of_week", "season_code", "doy_sin", "doy_cos",
               "target_doy_sin", "target_doy_cos"],
    "distance": ["horizon_days"],
    "price_level": ["log_price"],
    "crop_market": ["commodity_code", "market_code", "variety_code"],
}
FACTOR_TITLES = {
    "recent_week": "Recent market prices",
    "recent_month": "Price change over the last month",
    "averages": "Price compared with recent averages",
    "volatility": "Price ups and downs",
    "arrivals": "Market arrivals (supply)",
    "state_market": "Prices across Maharashtra",
    "season": "Seasonal pattern",
    "distance": "How far ahead the date is",
    "price_level": "Current price level",
    "crop_market": "Usual behaviour of this crop and market",
}


SMALL_EFFECT_PCT = 1.0  # contributions below this are reported as "small influence"
LAST_YEAR_FACTORS = ("recent_week", "recent_month", "averages", "volatility", "arrivals",
                     "state_market")


def _pct(log_value: float) -> float:
    return (math.exp(log_value) - 1.0) * 100.0


def _rose(value: float) -> str:
    return "rose" if value >= 0 else "fell"


def _describe(factor: str, x: dict, origin_month: int, target_month: int, horizon: int,
              price: float, commodity: str) -> str:
    """Plain statement of the *observed fact* behind a factor (no claims about causes)."""
    if factor == "recent_week":
        c = _pct(x["lag_7_change"])
        return f"{commodity} prices {_rose(c)} about {abs(c):.1f}% over the past week."
    if factor == "recent_month":
        c = _pct(x["lag_30_change"])
        return f"Prices {_rose(c)} about {abs(c):.1f}% compared with one month earlier."
    if factor == "averages":
        g = _pct(x["roll_mean_7_gap"])
        return (f"The latest price is {abs(g):.1f}% {'above' if g >= 0 else 'below'} "
                "its average over the past week.")
    if factor == "volatility":
        return (f"Prices have been moving up and down by about {x['volatility_30'] * 100:.1f}% "
                "a day over the past month.")
    if factor == "arrivals":
        a = _pct(x["arrivals_vs_30d"])
        more = a >= 0
        return (f"Arrivals at the market were {abs(a):.0f}% {'higher' if more else 'lower'} "
                f"than the 30-day average, which suggests {'more' if more else 'less'} "
                "supply pressure.")
    if factor == "state_market":
        g = _pct(x["state_price_gap"])
        w = _pct(x["state_change_7"])
        state_week = (f"Across Maharashtra, the median {commodity} price {_rose(w)} "
                      f"{abs(w):.1f}% over the past week.")
        if abs(g) < 0.05:  # the series *is* the state median
            return state_week
        return (f"This market's price is {abs(g):.1f}% {'above' if g >= 0 else 'below'} "
                f"the Maharashtra median. {state_week}")
    if factor == "season":
        if origin_month == target_month:
            return (f"In past years, {commodity} prices followed a typical pattern during "
                    f"{MONTHS[origin_month - 1]}.")
        return (f"In past years, {commodity} prices followed a typical pattern between "
                f"{MONTHS[origin_month - 1]} and {MONTHS[target_month - 1]}.")
    if factor == "distance":
        return (f"Your date is {horizon} day{'s' if horizon != 1 else ''} ahead; the model has "
                f"learned how {commodity} prices usually drift over that many days.")
    if factor == "price_level":
        return f"The starting price is ₹{price:,.0f} per quintal."
    return f"Past price behaviour of {commodity} in this market."


def explain_price(shap_row: np.ndarray, base_value: float, feature_values: dict,
                  feature_names: list[str], origin_month: int, price: float,
                  commodity: str, horizon: int = 0, target_month: int | None = None,
                  projected: bool = False, top_k: int = 3) -> dict:
    contrib = dict(zip(feature_names, map(float, shap_row)))
    target_month = target_month or origin_month

    factors = []
    for key, feats in FACTOR_GROUPS.items():
        if not any(f in contrib for f in feats):
            continue
        s = sum(contrib[f] for f in feats if f in contrib)
        effect = _pct(s)
        impact = "small" if abs(effect) < SMALL_EFFECT_PCT else ("higher" if s > 0 else "lower")
        obs = _describe(key, feature_values, origin_month, target_month, horizon, price,
                        commodity)
        if projected and key in LAST_YEAR_FACTORS:
            obs = f"Same time last year: {obs[0].lower()}{obs[1:]}"
        factors.append({
            "factor": key, "title": FACTOR_TITLES[key],
            "shap_value": round(s, 5), "effect_pct": round(effect, 2),
            "direction": "up" if s > 0 else "down", "impact": impact,
            "observation": obs,
        })
    factors.sort(key=lambda f: abs(f["shap_value"]), reverse=True)

    farmer = []
    for f in factors[:top_k]:
        if f["impact"] == "small":
            farmer.append(f"{f['observation']} This had only a small influence on the forecast.")
        else:
            farmer.append(f"{f['observation']} The model links this to a {f['impact']} "
                          f"predicted price (about {f['effect_pct']:+.1f}%).")

    total = sum(contrib.values())
    return {
        "method": "SHAP TreeExplainer (exact, tree-path-dependent)",
        "output_space": "log(price[t+h] / price[t])",
        "base_value": round(float(base_value), 5),
        "base_change_pct": round(_pct(base_value), 2),
        "prediction_change_pct": round(_pct(base_value + total), 2),
        "all_small": all(f["impact"] == "small" for f in factors[:top_k]),
        "farmer_explanation": farmer,
        "factors": factors,
        "simple": group_simple_factors(contrib),
    }
