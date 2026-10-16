"""Group the raw SHAP features of the daily price model into 6-7 plain-English factors.

The raw explanation has 30 inputs. This module merges related inputs (their SHAP values add up
in log space), keeps the biggest ones by absolute SHAP value, and folds the rest into a single
"All other factors combined" row. Each effect is converted to a percentage with
effect_% = (exp(shap) - 1) * 100.
"""
from __future__ import annotations

import math

SIMPLE_GROUPS: dict[str, dict] = {
    "price_level": {"label": "Current price level", "features": ["log_price"]},
    "seasonal": {"label": "Seasonal trend",
                 "features": ["doy_sin", "doy_cos", "week_of_year", "month", "season_code",
                              "day_of_week", "target_doy_sin", "target_doy_cos"]},
    "vs_average": {"label": "Price vs recent average",
                   "features": ["roll_mean_7_gap", "roll_mean_14_gap", "roll_mean_30_gap",
                                "momentum_7_30"]},
    "movement": {"label": "Recent price movement",
                 "features": ["lag_1_change", "lag_3_change", "lag_7_change", "lag_14_change",
                              "lag_30_change", "pct_change_7"]},
    "crop_market": {"label": "Usual crop & market pattern",
                    "features": ["commodity_code", "market_code", "variety_code"]},
    "horizon": {"label": "How far ahead the date is", "features": ["horizon_days"]},
    "volatility": {"label": "Price volatility", "features": ["volatility_30", "spread_ratio"]},
    "supply": {"label": "Market supply", "features": ["log_arrivals", "arrivals_vs_30d"]},
    "statewide": {"label": "Price vs rest of Maharashtra",
                  "features": ["state_price_gap", "state_change_7"]},
}

OTHER_LABEL = "All other factors combined"
SMALL_PCT = 1.0  # below this the effect is shown as "small"

# (factor, direction) -> plain meaning. Wording describes a learned pattern, not a cause.
MEANING = {
    ("price_level", "down"): "Today's price is high, so it may come down",
    ("price_level", "up"): "Today's price is low, so it may recover",
    ("seasonal", "up"): "Prices usually rise at this time of year",
    ("seasonal", "down"): "Prices usually fall at this time of year",
    ("vs_average", "up"): "Price is below its recent average, so it may rise back",
    ("vs_average", "down"): "Price is above its recent average",
    ("movement", "up"): "Prices have been climbing recently",
    ("movement", "down"): "Prices have been dropping recently",
    ("crop_market", "up"): "This crop and market normally trade higher",
    ("crop_market", "down"): "This crop and market normally trade lower",
    ("horizon", "up"): "Over this many days prices tend to drift up",
    ("horizon", "down"): "Longer forecasts are slightly less certain",
    ("volatility", "up"): "Prices have been swinging up and down",
    ("volatility", "down"): "Prices have been swinging up and down",
    ("supply", "up"): "Market arrivals suggest tighter supply",
    ("supply", "down"): "Market arrivals suggest plenty of supply",
    ("statewide", "up"): "Prices across Maharashtra point higher",
    ("statewide", "down"): "Prices across Maharashtra point lower",
}


def _pct(log_value: float) -> float:
    return (math.exp(log_value) - 1.0) * 100.0


def group_simple_factors(contrib: dict[str, float], top_k: int = 6) -> dict:
    """contrib: raw feature name -> SHAP value (log space).

    Returns {"factors": [...], "other": {...}}: the `top_k` merged factors sorted by absolute
    impact, plus one row for everything left over. Unknown features go to the leftover row.
    """
    merged = []
    used: set[str] = set()
    for key, spec in SIMPLE_GROUPS.items():
        present = [f for f in spec["features"] if f in contrib]
        if not present:
            continue
        used.update(present)
        merged.append((key, spec["label"], sum(contrib[f] for f in present)))
    merged.sort(key=lambda m: abs(m[2]), reverse=True)

    factors = []
    for key, label, s in merged[:top_k]:
        direction = "up" if s >= 0 else "down"
        pct = _pct(s)
        factors.append({
            "factor": key, "label": label,
            "meaning": MEANING.get((key, direction), ""),
            "shap_value": round(s, 5), "effect_pct": round(pct, 2),
            "direction": direction, "small": abs(pct) < SMALL_PCT,
        })

    rest = sum(s for _, _, s in merged[top_k:])
    rest += sum(v for f, v in contrib.items() if f not in used)
    other_pct = _pct(rest)
    other = {
        "factor": "other", "label": OTHER_LABEL,
        "meaning": "Small effects from the remaining inputs",
        "shap_value": round(rest, 5), "effect_pct": round(other_pct, 2),
        "direction": "up" if rest >= 0 else "down", "small": abs(other_pct) < SMALL_PCT,
    }
    return {"factors": factors, "other": other}
