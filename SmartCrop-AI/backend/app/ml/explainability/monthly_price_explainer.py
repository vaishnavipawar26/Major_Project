"""Farmer-friendly explanation of a monthly (selling-month) price forecast.

The model predicts the REAL log change from the latest observed month to the target month;
SHAP values are additive in that space:

    log(forecast / latest price) = base_value + sum(SHAP) + inflation term

A grouped SHAP value s corresponds to roughly (e^s - 1) x 100 % of the forecast. Each factor
sentence pairs an observed fact from the price history (e.g. "November prices have averaged
35% above the yearly average") with the size and direction of the model's SHAP effect.
"""
from __future__ import annotations

import math

import numpy as np

from app.ml.price_prediction.monthly import FACTOR_LABELS, FACTOR_OF

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
TECHNICAL_LABELS = {
    "horizon": "Months between latest data and selling month",
    "origin_month": "Calendar month of latest data",
    "target_month": "Selling (target) calendar month",
    "crop_code": "Crop encoding", "city_code": "City / market encoding",
    "mom_1": "Real price change vs previous month (log)",
    "mom_3": "Real price change vs 3 months earlier (log)",
    "level_vs_3m": "Price vs 3-month average (log)",
    "level_vs_12m": "Price vs 12-month average (log)",
    "volatility_6": "6-month volatility of monthly changes",
    "arrivals_vs_12m": "Arrivals vs 12-month average (log)",
    "city_premium": "City price vs state median (log)",
    "seasonal_prior": "Historical seasonal change, latest month -> selling month (log)",
    "seasonal_supply_prior": "Historical seasonal change in arrivals (log)",
}


def _pct(s: float) -> float:
    return (math.exp(s) - 1) * 100


def _fact(factor: str, crop: str, row: dict, price_profile, supply_profile, target_month: int,
          latest_label: str, city: str | None) -> str | None:
    m = MONTHS[target_month - 1]
    if factor == "season" and price_profile is not None:
        dev = _pct(price_profile[target_month])
        return (f"In 2023–2025, {crop} prices in {m} averaged {abs(dev):.0f}% "
                f"{'above' if dev >= 0 else 'below'} the yearly average.")
    if factor == "supply" and supply_profile is not None:
        dev = _pct(supply_profile[target_month])
        return (f"Mandi arrivals of {crop} in {m} are typically {abs(dev):.0f}% "
                f"{'above' if dev >= 0 else 'below'} the yearly average "
                f"({'more supply' if dev >= 0 else 'less supply'}).")
    if factor == "level" and not np.isnan(row.get("level_vs_12m", np.nan)):
        dev = _pct(row["level_vs_12m"])
        return (f"In {latest_label} the price was {abs(dev):.0f}% "
                f"{'above' if dev >= 0 else 'below'} its 12-month average; prices tend to drift "
                "back towards normal.")
    if factor == "momentum" and not np.isnan(row.get("mom_3", np.nan)):
        dev = _pct(row["mom_3"])
        return f"Prices {'rose' if dev >= 0 else 'fell'} about {abs(dev):.0f}% in the 3 months to {latest_label}."
    if factor == "local" and city and not np.isnan(row.get("city_premium", np.nan)):
        dev = _pct(row["city_premium"])
        return (f"{city} markets were {abs(dev):.0f}% {'above' if dev >= 0 else 'below'} the "
                "Maharashtra median recently.")
    if factor == "horizon":
        return f"The selling month is {int(row['horizon'])} months after the latest price data."
    if factor == "volatility":
        return "Recent month-to-month price swings affect how far the model moves from today's price."
    return None


def explain_monthly_price(*, crop: str, shap_values: dict[str, float], base_value: float,
                          row: dict, price_profile, supply_profile, target_month: int,
                          target_label: str, latest_label: str, latest_price: float,
                          predicted_price: float, inflation_effect_pct: float,
                          city: str | None, beats_baseline: bool) -> dict:
    grouped: dict[str, float] = {}
    for f, s in shap_values.items():
        grouped[FACTOR_OF[f]] = grouped.get(FACTOR_OF[f], 0.0) + s

    factors = []
    for key, s in sorted(grouped.items(), key=lambda kv: abs(kv[1]), reverse=True):
        effect = _pct(s)
        fact = _fact(key, crop, row, price_profile, supply_profile, target_month, latest_label, city)
        direction = "raises" if s > 0 else "lowers"
        text = (f"{fact + ' ' if fact else ''}This {direction} the forecast by about "
                f"{abs(effect):.0f}%.") if abs(effect) >= 0.5 else (
                f"{fact + ' ' if fact else ''}Little effect on this forecast.")
        factors.append({"factor": key, "label": FACTOR_LABELS[key], "shap_value": round(s, 5),
                        "effect_pct": round(effect, 1),
                        "direction": "up" if s > 0 else "down", "text": text})

    change = (predicted_price / latest_price - 1) * 100
    month_name = MONTHS[target_month - 1]
    movers = [f for f in factors if abs(f["effect_pct"]) >= 1][:2]
    why = " and ".join(f["label"].lower() for f in movers) if movers else "no single strong factor"
    headline = (f"{crop} price is projected to {'rise' if change >= 0 else 'fall'} about "
                f"{abs(change):.0f}% by {month_name} {target_label[:4]} "
                f"(₹{predicted_price:,.0f} vs ₹{latest_price:,.0f}/quintal in {latest_label}), "
                f"driven mainly by {why}; inflation adds about {inflation_effect_pct:.0f}%.")
    season = next((f for f in factors if f["factor"] == "season"), None)
    supply = next((f for f in factors if f["factor"] == "supply"), None)
    if season and price_profile is not None and supply_profile is not None:
        p_dev, s_dev = _pct(price_profile[target_month]), _pct(supply_profile[target_month])
        if p_dev > 5 and s_dev < -5:
            headline += (f" {month_name} is historically a high-price month because market "
                         f"arrivals drop about {abs(s_dev):.0f}%.")
        elif p_dev < -5 and s_dev > 5:
            headline += (f" {month_name} is historically a low-price month because market "
                         f"arrivals rise about {s_dev:.0f}% (harvest glut).")

    seasonal = None
    if price_profile is not None:
        seasonal = {"month": target_month, "price_vs_avg_pct": round(_pct(price_profile[target_month]), 1),
                    "arrivals_vs_avg_pct": None if supply_profile is None
                    else round(_pct(supply_profile[target_month]), 1)}

    technical = [{"feature": f, "label": TECHNICAL_LABELS.get(f, f),
                  "value": None if (isinstance(row[f], float) and np.isnan(row[f])) else round(float(row[f]), 4),
                  "shap_value": round(s, 5)}
                 for f, s in sorted(shap_values.items(), key=lambda kv: abs(kv[1]), reverse=True)]
    caveats = ["Based on 3 years (2023–2025) of Maharashtra mandi prices; long-range price "
               "forecasts are uncertain — use the likely range, not just the single number."]
    if not beats_baseline:
        caveats.insert(0, f"For {crop}, this model was not more accurate in testing than simply "
                          "carrying the latest price forward with inflation — treat as indicative.")
    return {"headline": headline, "factors": factors, "technical": technical, "seasonal": seasonal,
            "base_value": round(base_value, 5),
            "inflation_log": round(math.log1p(inflation_effect_pct / 100), 5),
            "method": "SHAP TreeExplainer on the XGBoost monthly price model (real log change)",
            "caveats": caveats}
