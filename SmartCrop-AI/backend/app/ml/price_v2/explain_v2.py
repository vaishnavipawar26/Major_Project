"""Evidence-based explanation of one candidate-model forecast (pure function, no I/O).

Five farmer-facing groups carry the model's SHAP contributions:
  Supply, Seasonal pattern, Market premium, Recent trend, Last-year comparison
(+ "other model factors": price level, swings, horizon, identifiers; reported, never hidden).

For every group the output states
  direction  which way the model's contribution pushed THIS forecast (sign of the group's SHAP sum),
  share      its share of the total absolute SHAP contribution,
  evidence   a measured value in plain words, taken from the feature values at the origin date.
Evidence and SHAP are different things and are labelled as such: SHAP says what the model did,
the evidence says what the data showed. Neither is presented as a proven cause.

If the predicted change is smaller than the typical error of past forecasts for this crop and
horizon (or the shrinkage weight is 0, i.e. the model added nothing over "price unchanged"),
no direction is claimed.
"""
from __future__ import annotations

import math

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]

GROUPS = {
    "supply": ["arr_vs_month_prior", "log_arrivals", "arrivals_vs_30d"],
    "seasonal": ["season_change", "month", "week_of_year", "season_code", "doy_sin", "doy_cos",
                 "target_doy_sin", "target_doy_cos"],
    "market_premium": ["state_price_gap", "market_premium_30d"],
    "recent_trend": ["lag_1_change", "lag_3_change", "lag_7_change", "lag_14_change", "lag_30_change",
                     "lag_90_change", "pct_change_7", "roll_mean_7_gap", "roll_mean_14_gap",
                     "roll_mean_30_gap", "momentum_7_30", "state_change_7"],
    "last_year": ["yoy_gap"],
}
TITLES = {"supply": "Supply (arrivals)", "seasonal": "Seasonal pattern", "market_premium": "Market premium",
          "recent_trend": "Recent trend", "last_year": "Compared with last year",
          "other": "Other model factors"}
MINOR_SHARE = 10.0     # a group below this share of the total is called minor
BAND_NAMES = ["1-7", "8-14", "15-30", "31-60"]


def band_of(h: int) -> str:
    return BAND_NAMES[0 if h <= 7 else 1 if h <= 14 else 2 if h <= 30 else 3]


def _ok(v) -> bool:
    return v is not None and isinstance(v, (int, float)) and math.isfinite(v)


def _pct(log_value: float) -> float:
    return (math.exp(log_value) - 1.0) * 100.0


def _rel(p: float, above="above", below="below") -> str:
    return "about the same as" if abs(p) < 1 else f"{abs(p):.0f}% {above if p >= 0 else below}"


def _a(month: str) -> str:
    return "an" if month[0] in "AEIOU" else "a"


def reading(group: str, v: dict) -> str | None:
    """Price direction a simple reading of the evidence alone would suggest ('up'/'down'), or None
    when the evidence is missing or too weak. Supply: arrivals above usual -> down. Seasonal: the sign
    of the earlier-year change. Recent trend: the last 30 days continue (a reversal shows as 'opposite')."""
    if group == "supply":
        x = v.get("arr_vs_month_prior")
        return None if not _ok(x) or abs(x) < 0.05 else ("down" if x > 0 else "up")
    if group == "seasonal":
        x = v.get("season_change")
        return None if not _ok(x) or abs(x) < 0.01 else ("up" if x > 0 else "down")
    if group == "recent_trend":
        x = v.get("lag_30_change")
        return None if not _ok(x) or abs(x) < 0.02 else ("up" if x > 0 else "down")
    return None


def evidence_text(group: str, v: dict, *, crop: str, horizon: int, origin_month: int,
                  series_is_state: bool, n_prior_years: int) -> str | None:
    """One sentence of measured evidence for the group, or None when the data does not exist."""
    month = MONTHS[origin_month - 1]
    if group == "supply":
        x = v.get("arr_vs_month_prior")
        if not _ok(x):
            return None
        p = _pct(x)
        scope = " (total of the markets that reported)" if series_is_state else ""
        if abs(p) < 5:
            return f"Arrivals over the last 30 days{scope} were close to the usual {month} level of earlier years."
        return f"Arrivals over the last 30 days{scope} were {_rel(p)} the usual {month} level of earlier years."
    if group == "seasonal":
        x = v.get("season_change")
        if not _ok(x) or n_prior_years < 1:
            return None
        p = _pct(x)
        weak = " (only one earlier year, so this is weak evidence)" if n_prior_years == 1 else ""
        return (f"In {n_prior_years} earlier year{'s' if n_prior_years != 1 else ''}, {crop} prices changed by "
                f"{p:+.1f}% on average over the {horizon} days after {_a(month)} {month} start{weak}.")
    if group == "market_premium":
        if series_is_state:
            return None
        g, g30 = v.get("state_price_gap"), v.get("market_premium_30d")
        if not _ok(g):
            return None
        s = f"This market's price was {_rel(_pct(g))} the Maharashtra median for {crop} on that date"
        if _ok(g30):
            s += f" ({_rel(_pct(g30))} on average over the last 30 days)"
        return s + "."
    if group == "recent_trend":
        a, b = v.get("lag_30_change"), v.get("lag_90_change")
        if not _ok(a):
            return None
        pa = _pct(a)
        mv = lambda p: "was about unchanged" if abs(p) < 1 else f"{'rose' if p >= 0 else 'fell'} {abs(p):.0f}%"   # noqa: E731
        s = f"The price {mv(pa)} over the last 30 days"
        if _ok(b):
            s += f" and {mv(_pct(b))} over the last 90 days"
        return s + "."
    if group == "last_year":
        x = v.get("yoy_gap")
        if not _ok(x):
            return None
        return f"The price was {_rel(_pct(x))} the same date last year."
    return None


def explain_forecast(shap_row, base_value: float, feature_names: list[str], values: dict, *,
                     crop: str, horizon: int, start_price: float, origin_date: str, shrink_w: float,
                     typical_error_log: float | None, reliability: dict | None,
                     series_is_state: bool = False, projected: bool = False,
                     n_prior_years: int = 0, price_range: tuple[float, float] | None = None,
                     model_output_log: float | None = None) -> dict:
    """Explanation for one forecast.

    ``shap_row``/``base_value``: contributions of the RAW model in log(price[t+h]/price[t]) space
    (already multiplied by h for rate-form models). The forecast shown to the user is the shrunk
    one: ``shrink_w`` x raw output, so every contribution is scaled by the same ``shrink_w``.
    ``typical_error_log``: median absolute log error of past forecasts of this crop and horizon band.
    ``reliability``: backtest figures for this crop x band (keys: n, mae, wape_pct, dir_acc_clear_pct,
    clear_rate_pct, skill_vs_no_change_pct)."""
    contrib = {n: float(s) * shrink_w for n, s in zip(feature_names, shap_row)}
    raw_change = float(base_value) + sum(float(s) for s in shap_row)
    pred_log = shrink_w * raw_change
    change_pct = _pct(pred_log)
    pred_price = start_price * math.exp(pred_log)

    grouped = {g: sum(contrib.get(f, 0.0) for f in fs) for g, fs in GROUPS.items()}
    used = {f for fs in GROUPS.values() for f in fs}
    grouped["other"] = sum(s for f, s in contrib.items() if f not in used)
    total_abs = sum(abs(s) for s in grouped.values()) or 1.0

    err_pct = _pct(typical_error_log) if _ok(typical_error_log) else None
    if shrink_w <= 0:
        code, why = "no_clear_direction", ("In past tests the model added nothing over keeping the latest price "
                                           f"for {crop} at this distance, so no direction is claimed.")
    elif err_pct is not None and abs(change_pct) < err_pct:
        code, why = "no_clear_direction", (f"The expected change ({change_pct:+.1f}%) is smaller than the typical "
                                           f"error of past forecasts (about {err_pct:.0f}%), so the price may "
                                           "move either way.")
    else:
        code, why = ("rise" if change_pct > 0 else "fall"), None
    headline = {"rise": f"The model expects {crop}'s price to rise by about {abs(change_pct):.0f}% over {horizon} days.",
                "fall": f"The model expects {crop}'s price to fall by about {abs(change_pct):.0f}% over {horizon} days.",
                "no_clear_direction": f"No clear direction for {crop}'s price over the next {horizon} days."}[code]

    prefix = "Based on the same date last year (data to the end of the dataset): " if projected else ""
    ctx = dict(crop=crop, horizon=horizon, origin_month=int(origin_date[5:7]),
               series_is_state=series_is_state, n_prior_years=n_prior_years)
    groups = []
    for g in list(GROUPS) + ["other"]:
        s = grouped[g]
        share = abs(s) / total_abs * 100
        ev = None if g == "other" else evidence_text(g, values, **ctx)
        rd = None if g == "other" else reading(g, values)
        pushed = "higher" if s > 0 else "lower"
        rel = None if g == "other" else ("weak" if rd is None else ("agrees" if (rd == "up") == (pushed == "higher") else "opposite"))
        groups.append({
            "group": g, "title": TITLES[g], "share_pct": round(share, 1), "shap_log": round(s, 5),
            "evidence_reading": rd, "evidence_vs_push": rel,
            "pushed": "higher" if s > 0 else "lower", "minor": share < MINOR_SHARE,
            "evidence": (prefix + ev[0].lower() + ev[1:]) if ev and prefix else ev,
            "evidence_available": ev is not None})
    groups.sort(key=lambda r: r["share_pct"], reverse=True)

    conf = None
    if reliability:
        r = reliability
        better = r.get("skill_vs_no_change_pct")
        cmp_ = ("no better than simply keeping the latest price" if better is None or better <= 0
                else f"{better:.0f}% more accurate than simply keeping the latest price")
        conf = {
            "basis": f"backtest on unseen dates, {crop}, {band_of(horizon)} days ahead, n={r['n']}",
            "text": (f"In backtests on unseen dates, {crop} forecasts {band_of(horizon)} days ahead missed by about "
                     f"₹{r['mae']:.0f} per quintal ({r['wape_pct']:.0f}%) on average and were {cmp_}. "
                     + (f"When the model gave a clear direction it was right {r['dir_acc_clear_pct']:.0f}% of the time."
                        if _ok(r.get("dir_acc_clear_pct")) else "It rarely gave a clear direction."))}
    notes = ["Contributions describe what the model did with each input; they show association in 2023–2025 data, not proven causes."]
    if projected:
        notes.append("The forecast starts from last year's prices (data end before today), so it is a seasonal-scenario estimate.")
    if any(g["group"] == "supply" and not g["evidence_available"] for g in groups):
        notes.append("Arrivals could not be compared with earlier years for this series.")

    return {
        "headline": headline, "direction": code, "why_no_direction": why,
        "start_price": round(start_price, 2), "predicted_price": round(pred_price, 2),
        "predicted_change_pct": round(change_pct, 2), "typical_error_pct": None if err_pct is None else round(err_pct, 1),
        "price_range": None if price_range is None else [round(price_range[0], 2), round(price_range[1], 2)],
        "range_basis": "80% split-conformal range from validation errors" if price_range else None,
        "origin_date": origin_date, "horizon_days": horizon, "shrink_weight": shrink_w,
        "groups": groups, "base_drift_log": round(float(base_value) * shrink_w, 5),
        "confidence": conf, "notes": notes,
        # base + sum(SHAP) must equal the raw model output (checked by the caller when it passes it)
        "reconstruction_error": None if model_output_log is None else round(abs(raw_change - float(model_output_log)), 8),
    }
