"""Farmer-friendly explanations of a price forecast: real evidence + correctly read model output.

Three things are kept apart for every factor (see ``build_factor``):

  A. observed   what the market data actually shows (measured values, comparison periods)
  B. model      which way the model's own calculation pushed this forecast, and how strongly
  C. meaning    what that may mean in practice, with its limits (association, never proof)

The model predicts y = log(price[t+h] / price[t]). SHAP values are additive in that space:

    base_value + sum(all feature contributions) == model output y        (up to float error)
    forecast price = reference price * exp(y)

Grouped contributions are therefore summed in log space. Converting each group with
(exp(s) - 1) * 100 gives a multiplicative equivalent of that group alone; those percentages
do NOT add up to the overall change, so they are never shown to farmers. Farmer-facing text
uses direction + strength words; the overall change is computed once from the model output.

Strength ("small" / "moderate" / "strong") compares |group contribution| with that group's own
distribution of contributions on held-out recent forecasts (``explanation_calibration.json``,
written by scripts/calibrate_explanations.py). It describes this forecast's inputs only. It is
not accuracy (see ``reliability``), not uncertainty (see the price range) and not data quality
(see ``data_completeness``); the four are reported separately and never merged.

A factor is only described when its evidence exists. Weather is explained only when the
model actually used weather inputs and they were available.
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np

from app.ml.explainability.simple_factors import group_simple_factors

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]

WEATHER_FEATURES = ["temp_mean_7", "temp_anom_7", "precip_sum_7", "precip_sum_30",
                    "precip_ratio_30", "humidity_mean_7"]

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
    "weather": WEATHER_FEATURES,
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
    "weather": "Weather",
}
# not shown to farmers as a "reason": they are identifiers, not market evidence
TECHNICAL_ONLY = ("crop_market",)

# Used only when no calibration file exists (flagged in the output as not calibrated).
FALLBACK_THRESHOLDS = {"moderate": 0.01, "strong": 0.03}   # |log contribution|
MIN_TESTS = 100   # fewer held-out forecasts than this: reliability figures are called insufficient
RECON_TOL = 1e-3  # |base + sum(contributions) - model output| allowed (float32 trees, rate-form scaling)
FLAT_PCT = 1.0   # overall changes smaller than this are called "about the same"
NEGLIGIBLE = 0.004                                           # never above "small" below this
STRENGTH_ORDER = {"small": 0, "moderate": 1, "strong": 2}


def pct_change(log_value: float) -> float:
    """Percent change equivalent of a log ratio. For a single measured change only."""
    return (math.exp(log_value) - 1.0) * 100.0


def _ok(x) -> bool:
    return x is not None and isinstance(x, (int, float, np.floating)) and math.isfinite(x)


def _up_down(v: float, up="higher", down="lower") -> str:
    return up if v >= 0 else down


def _rupees(v: float) -> str:
    return f"₹{v:,.0f}"


def strength_of(abs_log: float, group: str, calibration: dict | None) -> str:
    if abs_log < NEGLIGIBLE:
        return "small"
    th = (calibration or {}).get("groups", {}).get(group)
    mod, strong = (th["p50"], th["p85"]) if th else (FALLBACK_THRESHOLDS["moderate"],
                                                       FALLBACK_THRESHOLDS["strong"])
    mod = max(mod, NEGLIGIBLE)
    return "strong" if abs_log >= max(strong, mod) else ("moderate" if abs_log >= mod else "small")


# ----------------------------------------------------------------------------- evidence
def _item(label, value, unit, reference=None, ref_value=None, change_pct=None, source="reported prices"):
    return {"label": label, "value": value, "unit": unit, "reference": reference,
            "reference_value": ref_value, "change_pct": change_pct, "source": source}


def _evidence(group: str, x: dict, ctx: dict, commodity: str, price: float, origin_month: int,
              target_month: int, horizon: int) -> tuple[list[dict], str | None, str | None]:
    """(evidence items, observed sentence, trend) for one factor group.

    ``trend`` is "up"/"down"/"flat"/None: the direction of the *evidence itself*, used to
    check whether the model's push agrees with it. Returns ([], None, None) if the data is
    missing; the caller then does not describe the factor as evidence-backed."""
    c = ctx or {}
    if group == "recent_week":
        a, b = c.get("price_7d_avg"), c.get("price_prev_7d_avg")
        if _ok(a) and _ok(b) and b > 0:
            ch = (a / b - 1) * 100
            return ([_item("Average price, last 7 days", round(a, 1), "₹/quintal",
                           "average of the 7 days before", round(b, 1), round(ch, 1))],
                    f"{commodity}'s average price over the last 7 days was {_rupees(a)}, "
                    f"{abs(ch):.1f}% {'above' if ch >= 0 else 'below'} the {_rupees(b)} average "
                    "of the 7 days before.", _trend(ch))
        if _ok(a) and _ok(b) and b > 0 and _ok(x.get("lag_30_change")):
            c7, c30 = (a / b - 1) * 100, pct_change(x["lag_30_change"])
            return ([_item("Average price, last 7 days", round(a, 1), "₹/quintal", "average of the 7 days before", round(b, 1), round(c7, 1)),
                     _item("Latest price vs 30 days earlier", round(c30, 1), "%", "price 30 days earlier", None, round(c30, 1))],
                    f"The average price over the last 7 days was {abs(c7):.1f}% {'above' if c7 >= 0 else 'below'} the 7 days before, "
                    f"and the latest price is {abs(c30):.1f}% {'above' if c30 >= 0 else 'below'} the price 30 days earlier.", _trend(c7))
        if _ok(x.get("lag_7_change")):
            ch = pct_change(x["lag_7_change"])
            return ([_item("Latest price vs 7 days earlier", round(ch, 1), "%",
                           "price 7 days earlier", None, round(ch, 1))],
                    f"The latest {commodity} price is {abs(ch):.1f}% "
                    f"{'above' if ch >= 0 else 'below'} the price a week earlier.", _trend(ch))
    elif group == "recent_month":
        if _ok(x.get("lag_30_change")):
            ch = pct_change(x["lag_30_change"])
            return ([_item("Latest price vs 30 days earlier", round(ch, 1), "%",
                           "price 30 days earlier", None, round(ch, 1))],
                    f"The latest price is {abs(ch):.1f}% {'above' if ch >= 0 else 'below'} the price "
                    "30 days earlier.", _trend(ch))
    elif group == "averages":
        if _ok(x.get("roll_mean_7_gap")) and _ok(x.get("roll_mean_30_gap")):
            g7, g30 = pct_change(x["roll_mean_7_gap"]), pct_change(x["roll_mean_30_gap"])
            if not c.get("projected") and _ok(price) and price > 0:
                a7, a30 = price / math.exp(x["roll_mean_7_gap"]), price / math.exp(x["roll_mean_30_gap"])
                return ([_item("Latest price vs 7-day average", round(g7, 1), "%", "7-day average", round(a7, 1), round(g7, 1)),
                         _item("Latest price vs 30-day average", round(g30, 1), "%", "30-day average", round(a30, 1), round(g30, 1))],
                        f"The latest price of {_rupees(price)} is {abs(g7):.0f}% {'above' if g7 >= 0 else 'below'} its 7-day "
                        f"average ({_rupees(a7)}) and {abs(g30):.0f}% {'above' if g30 >= 0 else 'below'} its 30-day "
                        f"average ({_rupees(a30)}).", _trend(g30))
            return ([_item("Latest price vs 7-day average", round(g7, 1), "%", "7-day average", None, round(g7, 1)),
                     _item("Latest price vs 30-day average", round(g30, 1), "%", "30-day average", None, round(g30, 1))],
                    f"The latest price is {abs(g7):.1f}% {'above' if g7 >= 0 else 'below'} its 7-day "
                    f"average and {abs(g30):.1f}% {'above' if g30 >= 0 else 'below'} its 30-day average.",
                    _trend(g30))
    elif group == "volatility":
        if _ok(x.get("volatility_30")):
            v = x["volatility_30"] * 100
            items = [_item("Typical daily price change, last 30 days", round(v, 2), "% per day",
                           "standard deviation of daily changes", None, None)]
            txt = (f"Over the last 30 days the price typically moved by about {v:.1f}% from one "
                   "reported day to the next.")
            if _ok(x.get("spread_ratio")):
                sp = (math.exp(x["spread_ratio"]) - 1) * 100
                items.append(_item("Gap between highest and lowest price on the latest day",
                                   round(sp, 1), "% of the lowest price", None, None, None))
                txt += f" On the latest day the highest price was {sp:.0f}% above the lowest."
            return items, txt, None   # swings carry no trend
    elif group == "arrivals":
        a7, p7 = c.get("arrivals_7d_mean"), c.get("arrivals_prev_7d_mean")
        if _ok(a7) and _ok(p7) and p7 > 0 and c.get("arrivals_asof"):
            ch = (a7 / p7 - 1) * 100
            d = date.fromisoformat(c["arrivals_asof"])
            scope = " (total of the markets that reported)" if c.get("series_is_state") else ""
            return ([_item("Reported arrivals, last 7 days", round(a7, 1), "per day", "the 7 days before", round(p7, 1), round(ch, 1), "reported arrivals")],
                    f"Reported arrivals{scope} averaged {a7:,.0f} a day in the 7 days to {d.day} {MONTHS[d.month - 1]}, "
                    f"{abs(ch):.0f}% {'above' if ch >= 0 else 'below'} the {p7:,.0f} a day of the 7 days before.", _trend(ch, 5))
        a, m = c.get("arrivals_latest"), c.get("arrivals_30d_mean")
        if _ok(a) and _ok(m) and m > 0:
            ch = (a / m - 1) * 100
            return ([_item("Latest reported arrivals", round(a, 1), "as reported",
                           "average of the last 30 days", round(m, 1), round(ch, 1), "reported arrivals")],
                    f"Reported arrivals at the market were {abs(ch):.0f}% "
                    f"{'above' if ch >= 0 else 'below'} their 30-day average.", _trend(ch, 5))
    elif group == "state_market":
        if _ok(x.get("state_change_7")):
            w = pct_change(x["state_change_7"])
            items = [_item("Maharashtra median price, last 7 days", round(w, 1), "%", "a week earlier", None, round(w, 1))]
            txt = (f"Across Maharashtra the median {commodity} price "
                   f"{'rose' if w >= 0 else 'fell'} {abs(w):.1f}% over the past week.")
            if not c.get("series_is_state") and _ok(x.get("state_price_gap")):
                g = pct_change(x["state_price_gap"])
                items.append(_item("This market vs Maharashtra median", round(g, 1), "%", "state median", None, round(g, 1)))
                txt = (f"This market's price is {abs(g):.1f}% {'above' if g >= 0 else 'below'} the "
                       f"Maharashtra median. " + txt)
            return items, txt, _trend(w)
    elif group == "season":
        s = c.get("seasonal")
        o, t = MONTHS[origin_month - 1], MONTHS[target_month - 1]
        span = o if o == t else f"{o} and {t}"
        if s and s.get("years", 0) >= 1 and _ok(s.get("ratio")):
            ch = (s["ratio"] - 1) * 100
            n = s["years"]
            rs = s.get("ratios") or []
            same = sum(1 for r in rs if (r > 1) == (s["ratio"] > 1))
            tail = ""
            if n < 2:
                tail = "; only one earlier year is available, so this evidence is limited"
            elif rs and same / len(rs) < 0.67:
                tail = f"; the pattern is inconsistent ({same} of {len(rs)} years moved that way)"
            elif rs:
                tail = f"; {same} of {len(rs)} years moved that way"
            return ([_item(f"Typical price change, {span}, in earlier years", round(ch, 1), "%",
                           f"same window in {n} earlier year{'s' if n != 1 else ''}", n, round(ch, 1),
                           "earlier years of the same series")],
                    f"In the {n} earlier year{'s' if n != 1 else ''} of data, {commodity} prices "
                    f"around the target date were {abs(ch):.1f}% "
                    f"{'above' if ch >= 0 else 'below'} prices around the forecast start ({o if o == t else o + ' to ' + t}){tail}.",
                    "flat" if (n < 2 or (rs and same / len(rs) < 0.67)) else _trend(ch))
        return [], None, None
    elif group == "price_level":
        med = c.get("year_median_price")
        pr = c.get("price_ref", price)   # price in the same (reference-year) scale as the median
        if _ok(med) and med > 0:
            ch = (pr / med - 1) * 100
            return ([_item("Starting price", round(pr, 1), "₹/quintal", "median of the past year",
                           round(med, 1), round(ch, 1))],
                    f"The starting price of {_rupees(pr)} per quintal is {abs(ch):.0f}% "
                    f"{'above' if ch >= 0 else 'below'} its median over the past year ({_rupees(med)}).",
                    _trend(ch, 5))
        return ([_item("Starting price", round(price, 1), "₹/quintal", None, None, None)],
                f"The starting price is {_rupees(price)} per quintal.", None)
    elif group == "distance":
        txt = f"The forecast date is {horizon} day{'s' if horizon != 1 else ''} after the starting price."   # accuracy figures live under reliability
        return [_item("Days ahead", horizon, "days")], txt, None
    elif group == "weather":
        if all(_ok(x.get(f)) for f in WEATHER_FEATURES):
            nrm = c.get("weather_normals_years", "2015–2022")
            tmp, an = x["temp_mean_7"], x["temp_anom_7"]
            p30, r30 = x["precip_sum_30"], x["precip_ratio_30"]
            return ([_item("Average temperature, last 7 days", round(tmp, 1), "°C",
                           f"normal for this time of year ({nrm})", round(tmp - an, 1), None,
                           "observed weather (reanalysis)"),
                     _item("Rainfall, last 30 days", round(p30, 0), "mm",
                           f"normal for this time of year ({nrm})", None, None,
                           "observed weather (reanalysis)")],
                    f"The last 7 days averaged {tmp:.1f}°C, {abs(an):.1f}°C "
                    f"{'warmer' if an >= 0 else 'cooler'} than normal for the time of year. "
                    f"Rainfall over the last 30 days was {p30:.0f} mm, about {r30 * 100:.0f}% of normal "
                    "(the ratio uses a 10 mm allowance for dry months). "
                    "This is weather that was observed up to the forecast start, not a weather forecast.",
                    None)
    return [], None, None


def _trend(change_pct: float, flat: float = 1.0) -> str:
    return "flat" if abs(change_pct) < flat else ("up" if change_pct > 0 else "down")


# ----------------------------------------------------------------------------- wording
def _model_sentence(direction: str, strength: str, subject: str) -> str:
    if strength == "small":
        return f"{subject} had only a small effect on the forecast."
    way = "higher" if direction == "up" else "lower"
    return f"{subject} had a {strength} effect, pointing the forecast {way}."


def _meaning(group: str, direction: str, trend: str | None, commodity: str, ctx: dict) -> str:
    """Practical reading with its limits. Never claims a cause."""
    agree = trend in (None, "flat") or trend == direction
    if group in ("recent_week", "recent_month", "averages"):
        base = ("Price movements over a few days or weeks sometimes continue and sometimes reverse; "
                "they are one clue, not a rule.")
        if not agree:
            base = ("The recent movement and the model's push point in opposite directions, so the "
                    "model is relying on a pattern from past data that is not simply 'the trend "
                    "continues'. " + base)
        return base
    if group == "arrivals":
        if trend == "up":
            m = ("Higher arrivals can mean more supply, which sometimes puts downward pressure on prices.")
        elif trend == "down":
            m = ("Lower arrivals can mean tighter supply, which sometimes supports prices.")
        else:
            m = "Arrivals are close to normal, so supply is not an obvious pressure."
        m += " This is an association seen in data; it does not prove that arrivals cause price changes."
        if not agree and trend in ("up", "down"):
            expected = "lower" if trend == "up" else "higher"
            m += (f" Here the model's push is not the {expected} direction that supply alone would "
                  "suggest, so other patterns outweighed it.")
        return m
    if group == "volatility":
        return ("Large price swings mean the price is harder to pin down. Swings describe how "
                "unsettled the market is; they do not say whether prices will rise or fall. The "
                "direction shown here comes from the model's calculation.")
    if group == "state_market":
        return ("Prices in one market often move with the wider state, but a local market can "
                "differ.")
    if group == "season":
        n = (ctx.get("seasonal") or {}).get("years", 0)
        extra = (f" Only {n} earlier year{'s' if n != 1 else ''} of data exist for this period, so "
                 "the pattern is a weak guide.") if n < 3 else ""
        return "Seasonal patterns repeat only roughly from year to year." + extra
    if group == "price_level":
        return ("In past data, unusually high prices have often drifted down and unusually low ones "
                "have often recovered. This is a tendency, not a guarantee.")
    if group == "distance":
        return "The further ahead the date, the less the latest prices say about it."
    if group == "weather":
        return ("Weather can affect crop supply and quality with a delay, and differently for each "
                "crop, place and season. The link to market price is indirect and is not proven "
                "by this model.")
    return ""


def _push_sentence(group: str, direction: str) -> str:
    """What the model did with this factor, in plain words. Direction is the sign of its SHAP contribution
    (valid because the explained output is log(price_target / price_start): positive means a higher forecast)."""
    way = "higher" if direction == "up" else "lower"
    what = {"recent_week": "the model's learned pattern for recent price movement",
            "recent_month": "the model's learned pattern for the last month's price movement",
            "averages": "the model's learned pattern for a price at this distance from its recent averages",
            "volatility": "the model's learned pattern for recent price swings",
            "arrivals": "the model's learned pattern for market arrivals",
            "state_market": "the model's learned pattern for prices across Maharashtra",
            "season": "the model's learned pattern for this time of year",
            "distance": "the model's learned pattern for a forecast this far ahead",
            "price_level": "the model's learned pattern for a price at this level",
            "weather": "the model's learned pattern for recent weather",
            "crop_market": "the model's learned pattern for this crop and market"}[group]
    return f"{what[0].upper() + what[1:]} pushed the forecast {way}."


# ----------------------------------------------------------------------------- main
def build_factor(group: str, s: float, x: dict, ctx: dict, commodity: str, price: float,
                 origin_month: int, target_month: int, horizon: int, projected: bool,
                 calibration: dict | None) -> dict:
    direction = "up" if round(s, 5) > 0 else "down"   # the sign the page shows (shap_value is rounded to 5 places)
    strength = strength_of(abs(s), group, calibration)
    items, observed, trend = _evidence(group, x, ctx, commodity, price, origin_month,
                                       target_month, horizon)
    has_evidence = bool(observed)
    if projected and observed and group in ("recent_week", "recent_month", "averages",
                                            "volatility", "arrivals", "state_market", "weather", "price_level"):
        observed = "Same time last year: " + (observed if observed.startswith(commodity) else observed[0].lower() + observed[1:])
    subject = {"recent_week": "Recent prices", "recent_month": "The month's price change",
               "averages": "The price compared with recent averages",
               "volatility": "The recent price swings", "arrivals": "Market arrivals",
               "state_market": "Prices across Maharashtra", "season": "The seasonal pattern",
               "distance": "The number of days ahead", "price_level": "The current price level",
               "weather": "Weather", "crop_market": "This crop and market"}[group]
    model = _model_sentence(direction, strength, subject)
    # a small effect gets no practical reading: it would only add noise
    meaning = (_meaning(group, direction, trend, commodity, ctx or {})
               if has_evidence and strength != "small" else "")
    return {
        "factor": group, "title": FACTOR_TITLES[group],
        "direction": direction, "strength": strength,
        "impact": "small" if strength == "small" else ("higher" if direction == "up" else "lower"),
        "shap_value": round(s, 5), "shap_scale": "log of price ratio (adds up across factors)",
        "evidence": items, "evidence_available": has_evidence,
        "observation": observed or "", "model_says": model, "meaning": meaning,
        "farmer_effect": _push_sentence(group, direction),
        "evidence_trend": trend,
        "sentence": " ".join(p for p in (observed, model, meaning) if p),
    }



# ----------------------------------------------------------------------------- farmer-facing reasons
# Only market-based categories can be a reason. Days-ahead, swings and identifiers are model plumbing, not market evidence.
REASON_TITLES = {"recent_week": "Recent price trend", "averages": "Price compared with recent averages",
                 "price_level": "Price compared with its usual level", "season": "Seasonal pattern",
                 "arrivals": "Market arrivals", "state_market": "Prices across Maharashtra", "weather": "Weather"}
MAX_REASONS = 3


def _reason_meaning(group: str, direction: str, trend: str | None, seasonal_ok: bool) -> str:
    """One sentence on what the evidence means for this forecast. It states the model's push (its SHAP sign) and only
    compares it with the observed pattern; it never says the pattern caused the price."""
    way = "higher" if direction == "up" else "lower"
    push = f"pushed this forecast {way}"
    if group == "recent_week":
        if trend in (None, "flat"):
            return f"The model's learned patterns for recent price changes {push}."
        return (f"The model's learned patterns for recent price changes {push}, consistent with the recent movement continuing."
                if trend == direction else
                f"The model's learned patterns for recent price changes {push}, which points to a possible reversal of the recent movement.")
    if group == "averages":
        side = {"up": "above", "down": "below"}.get(trend or "")
        return (f"When a price sits {side} its recent averages, the model's learned patterns {push}." if side
                else f"The model's learned patterns for the price relative to its recent averages {push}.")
    if group == "price_level":
        side = {"up": "above", "down": "below"}.get(trend or "")
        return (f"When the starting price is {side} its usual level, the model's learned patterns {push}; this is a learned tendency, not a rule."
                if side else f"The model's learned patterns for a price at this level {push}.")
    if group == "season":
        if not seasonal_ok:
            return f"The model's seasonal pattern {push}, but the earlier years give only weak guidance."
        return (f"The model's seasonal pattern {push}, in line with what earlier years show."
                if trend == direction else
                f"The model's seasonal pattern {push}, although the simple comparison of earlier years points the other way.")
    if group == "arrivals":
        base = {"up": "Higher arrivals can put downward pressure on prices when demand does not rise in step",
                "down": "Lower arrivals can support prices",
                "flat": "Arrivals are close to their recent level"}.get(trend or "flat")
        plain = {"up": "down", "down": "up"}.get(trend or "")   # the direction supply alone would suggest
        if plain and direction != plain:
            return f"{base}, but the model's learned patterns for arrivals {push} instead, so other patterns outweighed this."
        return f"{base}; the model's learned patterns for arrivals {push}."
    if group == "state_market":
        return f"The model's learned patterns for prices across Maharashtra {push}."
    return f"The model's learned patterns for this factor {push}."


def build_reasons(factors: list[dict], ctx: dict, limit: int = MAX_REASONS) -> list[dict]:
    """The (at most ``limit``) strongest reasons that have BOTH a model contribution and measured evidence.

    Recent-week and recent-month changes are one farmer-facing reason ("recent price trend"); their contributions
    are summed, which is valid because SHAP values are additive in the output space."""
    pool = {f["factor"]: f for f in factors if f["evidence_available"] and f["factor"] in REASON_TITLES}
    if "recent_month" in {f["factor"] for f in factors} and "recent_week" not in pool:
        m = next(f for f in factors if f["factor"] == "recent_month")
        if m["evidence_available"]:
            pool["recent_week"] = {**m, "factor": "recent_week"}
    reasons = []
    for key, f in pool.items():
        # a measured change of about zero is not a reason; only the seasonal card may say "weak evidence"
        if f["evidence_trend"] == "flat" and key != "season":
            continue
        s = f["shap_value"]
        if key == "recent_week":
            s = sum(g["shap_value"] for g in factors if g["factor"] in ("recent_week", "recent_month"))
        direction = "up" if round(s, 5) > 0 else "down"   # the sign the page shows (shap_value is rounded to 5 places)
        sea = ctx.get("seasonal") or {}
        rs = sea.get("ratios") or []
        seasonal_ok = sea.get("years", 0) >= 2 and (not rs or sum(1 for r in rs if (r > 1) == (sea.get("ratio", 1) > 1)) / len(rs) >= 0.67)
        reasons.append({
            "id": key, "title": REASON_TITLES[key], "direction": direction, "shap_value": round(s, 5),
            "evidence": f["observation"], "meaning": _reason_meaning(key, direction, f["evidence_trend"], seasonal_ok),
            "trend": f["evidence_trend"], "limited": key == "season" and not seasonal_ok,
        })
    reasons.sort(key=lambda r: abs(r["shap_value"]), reverse=True)
    return reasons[:limit]


def _because(r: dict) -> str | None:
    """A noun phrase for "because of ...", worded from the evidence's own direction (never stronger than the data)."""
    t = r["trend"]
    return {
        "recent_week": {"down": "the recent fall in prices", "up": "the recent rise in prices"}.get(t, "recent price changes"),
        "averages": {"up": "the latest price being above its recent averages", "down": "the latest price being below its recent averages"}.get(t, "the price relative to its recent averages"),
        "price_level": {"up": "the starting price being above its usual level", "down": "the starting price being below its usual level"}.get(t, "the price level"),
        "arrivals": {"up": "higher reported arrivals", "down": "lower reported arrivals"}.get(t, "reported arrivals"),
        "state_market": {"up": "the rise in prices across Maharashtra", "down": "the fall in prices across Maharashtra"}.get(t, "prices across Maharashtra"),
        "season": "a seasonal pattern the model learned (earlier-year evidence is limited)" if r["limited"] else "the seasonal pattern in earlier years",
        "weather": "recent weather",
    }.get(r["id"])


def what_it_means(reasons: list[dict], net: dict | None) -> str | None:
    """Two short sentences that combine the shown reasons. Names only factors that point the same way as the forecast."""
    if not reasons or not net:
        return None
    tail = "However, the actual price may differ if supply or demand change."
    if net["code"] == "flat":
        return f"The model expects little change, and the strongest factors do not point clearly one way. {tail}"
    if net["code"] == "mixed":
        return f"The strongest factors pull in different directions, so there is no single clear reason for the expected change. {tail}"
    parts = [p for p in (_because(r) for r in reasons if r["direction"] == net["forecast_side"]) if p]
    if not parts:
        return None
    joined = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"
    return f"The forecast is {'higher' if net['forecast_side'] == 'up' else 'lower'} mainly because of {joined}. {tail}"


def _net_summary(top: list[dict], change_pct: float, word: str) -> dict | None:
    """Do the shown factors explain the direction of the forecast? Decided by their signed SHAP sums.

    Contributions are additive in the output space, so comparing the summed up-pushes with the summed
    down-pushes is valid. The forecast also contains the model's base value and every other feature, so the
    three factors are said to explain the direction only when the side that wins agrees with the forecast."""
    if not top:
        return None
    up = [f for f in top if f["direction"] == "up"]
    down = [f for f in top if f["direction"] == "down"]
    up_sum, down_sum = sum(f["shap_value"] for f in up), -sum(f["shap_value"] for f in down)
    side = "up" if up_sum > down_sum else "down"
    forecast_side = None if word == "about the same" else ("up" if change_pct > 0 else "down")
    names = lambda fs: [f["title"].lower() for f in fs]   # noqa: E731
    out = {"higher": names(up), "lower": names(down), "up_total": round(up_sum, 5), "down_total": round(down_sum, 5)}
    if forecast_side is None:
        code = "flat"
    elif not up or not down:
        code = "agree" if side == forecast_side else "mixed"
    else:
        code = "outweigh" if side == forecast_side else "mixed"
    out["code"] = code
    out["forecast_side"] = forecast_side
    return out


def explain_price(shap_row: np.ndarray, base_value: float, feature_values: dict,
                  feature_names: list[str], origin_month: int, price: float,
                  commodity: str, horizon: int = 0, target_month: int | None = None,
                  projected: bool = False, top_k: int = 3, *, context: dict | None = None,
                  calibration: dict | None = None, target_point: dict | None = None,
                  weather_status: str = "not_used", model_output: float | None = None,
                  n_tests: int | None = None) -> dict:
    """Explanation of one forecast.

    ``shap_row``/``base_value`` are in the model's log-ratio output space (already multiplied
    by the horizon for rate-form models). ``context`` carries evidence computed from the
    price series by the forecaster (see PriceForecaster._evidence_context); everything in it
    is optional. ``target_point`` is the forecast path entry the explanation belongs to.
    ``model_output`` is the model's own prediction for the same row (log ratio); when given, the
    SHAP reconstruction base + sum(contributions) is checked against it. ``n_tests`` is the number
    of held-out forecasts behind the reliability figures."""
    contrib = dict(zip(feature_names, map(float, shap_row)))
    target_month = target_month or origin_month
    ctx = {**(context or {}), "projected": projected}
    x = {k: (float(v) if _ok(v) else None) for k, v in feature_values.items()}
    total = sum(contrib.values())
    model_log_change = base_value + total

    factors = []
    for key, feats in FACTOR_GROUPS.items():
        if not any(f in contrib for f in feats):
            continue
        if key == "weather" and not all(_ok(x.get(f)) for f in WEATHER_FEATURES):
            continue   # weather features missing for this forecast: never describe them
        s = sum(contrib[f] for f in feats if f in contrib)
        factors.append(build_factor(key, s, x, ctx, commodity, price, origin_month, target_month,
                                    horizon, projected, calibration))
    factors.sort(key=lambda f: abs(f["shap_value"]), reverse=True)

    shown = [f for f in factors if f["evidence_available"] and f["factor"] not in TECHNICAL_ONLY]
    top = shown[:top_k]
    farmer = [f["sentence"] for f in top]
    higher = [f["factor"] for f in shown if f["direction"] == "up" and f["strength"] != "small"]
    lower = [f["factor"] for f in shown if f["direction"] == "down" and f["strength"] != "small"]

    change_pct = pct_change(model_log_change)
    pred_price = price * math.exp(model_log_change)
    sp = target_point or {}
    band = sp.get("stable_band_pct")
    if abs(change_pct) < FLAT_PCT:
        word = "about the same"
    else:
        word = "higher" if change_pct > 0 else "lower"
    within_error = band is not None and abs(change_pct) < band
    summary = {
        "reference_price": round(price, 2), "predicted_price": round(sp.get("predicted_price", pred_price), 2),
        "change_abs": round(sp.get("predicted_price", pred_price) - price, 2),
        "change_pct": round(change_pct, 2), "direction": word, "horizon_days": horizon,
        "within_typical_error": within_error, "typical_error_pct": band,
        "headline": (f"Why does {commodity}'s price forecast show little change?" if word == "about the same"
                     else f"Why is {commodity}'s price forecast {word}?"),
    }
    reasons = build_reasons(factors, ctx)
    net_summary = _net_summary(reasons, change_pct, word)
    stat = ctx.get("series_is_state")
    reliability = None
    if ctx.get("reliability"):
        r = ctx["reliability"]
        reliability = {"basis": "historical accuracy of this model at this distance (walk-forward tests)",
                       "model_mae": r.get("model_mae"), "baseline_mae": r.get("baseline_mae"),
                       "beats_no_change": r.get("validated"), "n_tests": n_tests,
                       "sufficient_data": n_tests is not None and n_tests >= MIN_TESTS}
    price_range = None
    if sp.get("lower") is not None:
        price_range = {"basis": "80% range calibrated on held-out forecast errors "
                                "(not derived from the factors above)",
                       "lower": sp["lower"], "upper": sp["upper"]}
    grouped = {f["factor"]: {"title": f["title"], "shap_value": f["shap_value"],
                             "features": [n for n in FACTOR_GROUPS[f["factor"]] if n in contrib]}
               for f in factors}
    recon_err = None if model_output is None else abs(model_log_change - float(model_output))
    missing = [f for f in feature_names if f in x and x[f] is None]
    completeness = {"basis": "share of the model's inputs that were available",
                    "inputs_total": len(feature_names),
                    "inputs_missing": len(missing), "missing": missing[:10]}

    limits = []
    if projected:
        limits.append("The forecast starts after the last date in the price data, so it reuses "
                      "market behaviour from the same time of an earlier year, adjusted for "
                      "inflation. Treat it as a seasonal guide.")
    if within_error:
        limits.append(f"The expected change is smaller than the forecast's typical error "
                      f"(about {band:.0f}%), so the price may well stay close to where it is now.")
    if reliability and reliability["beats_no_change"] is False:
        limits.append("In past tests the model did not beat 'the price stays unchanged' for this "
                      "crop at this distance, so treat this forecast as a rough guide.")
    if reliability and not reliability["sufficient_data"]:
        limits.append("Not enough historical test results are available to estimate how reliable "
                      "this forecast is.")
    sea = ctx.get("seasonal")
    if not sea or sea.get("years", 0) < 2:
        limits.append("Fewer than two earlier years of price history exist for this period, so "
                      "seasonal comparisons are weak.")
    if weather_status == "unavailable":
        limits.append("Weather information was not available for this market, so it was not used.")
    limits.extend(ctx.get("notes", []))

    return {
        "method": "SHAP TreeExplainer (exact, tree-path-dependent)",
        "output_space": "log(price[t+h] / price[t])",
        "base_value": round(float(base_value), 5),
        "base_change_pct": round(pct_change(base_value), 2),
        "prediction_change_pct": round(change_pct, 2),
        "all_small": all(f["strength"] == "small" for f in top) if top else True,
        "summary": summary,
        "farmer_explanation": farmer,
        "main_factors": [f["factor"] for f in top],
        "net_summary": net_summary,
        "reasons": reasons,
        "what_it_means": what_it_means(reasons, net_summary),
        "scope": {"kind": "state" if stat else "market",
                  "text": ("Prices are the median across the Maharashtra markets that reported each day, and arrivals are the total "
                           "those markets reported, so arrivals also change with how many markets reported.") if stat
                  else "Prices and arrivals are for the selected market only."},
        "data_basis": {"kind": "historical", "projected": projected, "data_end": ctx.get("data_end"),
                       "text": ("Based on historical prices" + (f" up to {ctx['data_end']}" if ctx.get("data_end") else "")
                                + (", repeated for the same season and adjusted for inflation. " if projected else ". ")
                                + "No live market feed is connected, so this does not describe today's market conditions.")},   # the (at most) top_k strongest by |SHAP| that have evidence
        "projected": projected,
        "factors": factors,
        "higher_factors": higher, "lower_factors": lower,
        "reliability": reliability, "price_range": price_range,
        "data_completeness": completeness, "data_limitations": limits,
        "weather": {"status": weather_status, "used": any(f["factor"] == "weather" for f in factors)},
        "strength_basis": ("calibrated on held-out forecasts" if calibration
                           else "uncalibrated fallback thresholds"),
        "technical": {
            "model_output_log": round(model_log_change, 6),
            "sum_of_contributions_log": round(total, 6),
            "explainer_type": "shap.TreeExplainer (exact, tree-path-dependent)",
            "model_prediction_log": None if model_output is None else round(float(model_output), 6),
            "reconstruction_error": None if recon_err is None else round(recon_err, 8),
            "reconstruction_ok": None if recon_err is None else bool(recon_err <= RECON_TOL),
            "reconstruction_tolerance": RECON_TOL,
            "grouped": grouped,
            "feature_values": {k: (None if v is None else round(v, 6)) for k, v in x.items()},
            "note": ("Per-factor values are in log space and add up to the model output. "
                     "Converting each to a percent separately does not add up to the total change."),
            "features": {k: round(v, 6) for k, v in contrib.items()},
        },
        "simple": group_simple_factors(contrib),
    }
