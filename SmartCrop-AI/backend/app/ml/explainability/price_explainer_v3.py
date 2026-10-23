"""Evidence-first, rupee-denominated explanation of one price forecast (pure functions, no I/O).

What the farmer gets (see ``build_v3``):
  * a headline that is "rise" / "fall" only when the expected change is larger than the model's backtest error
    for this crop and horizon band AND the model beat its baseline there; otherwise "about the same" / "no clear direction";
  * reason cards in ₹: for each group (supply, selected market, seasonal pattern, recent trend, compared with
    last year, weather) the direction and ₹ effect, a DATED evidence sentence with real numbers, a mechanism
    sentence only when the evidence supports it, and a flag saying whether the measured evidence and the
    model's push point the same way;
  * "other factors" with its ₹ share (never hidden), a market-vs-median breakdown and a trust block built
    from backtest figures for this crop and band (with case counts).

₹ allocation (documented here and returned in ``method``):
    The model predicts L = log(price[t+h] / start). SHAP values add up: base + sum(contributions) = L.
    The predicted change in rupees is  dP = start * (exp(L) - 1).  Each log contribution s_g is converted with
        inr_g = start * s_g * (exp(L) - 1) / L          (the factor tends to 1 as L -> 0)
    so that the ₹ effects of all groups plus the model's baseline drift add up EXACTLY to dP.
    Nothing is converted separately with exp(s) - 1 (those would not add up).

Context-only mode (``context_only=True``): used for crops/cells where backtests show the model does not beat keeping
the price unchanged. The model's push is then NOT used: the verdict is "no clear direction", no rupee effects, no
agreement flags and no mechanism sentences are shown, and the dated records (supply, market premium, trend, last
year, seasonal) are listed as plain context.

No cause is claimed. "More supply usually lowers prices" is printed only when arrivals were at least 10 %
above the earlier-year level; no festival, transport or demand reason is ever invented.
"""
from __future__ import annotations

import math
from datetime import date

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEATHER_FEATURES = ["temp_mean_7", "temp_anom_7", "precip_sum_7", "precip_sum_30", "precip_ratio_30", "humidity_mean_7"]

GROUP_FEATURES = {
    "supply": ["log_arrivals", "arrivals_vs_30d", "arr_vs_month_prior"],
    "market": ["state_price_gap", "state_change_7", "market_code", "variety_code", "market_premium_30d"],
    "seasonal": ["month", "season_code", "doy_sin", "doy_cos", "target_doy_sin", "target_doy_cos", "season_change"],
    "trend": ["lag_1_change", "lag_3_change", "lag_7_change", "lag_14_change", "lag_30_change", "lag_90_change",
              "pct_change_7", "roll_mean_7_gap", "roll_mean_14_gap", "roll_mean_30_gap", "momentum_7_30"],
    "last_year": ["yoy_gap"],
    "weather": WEATHER_FEATURES,
}
OTHER_PARTS = {
    "price_level": (["log_price"], "Current price level"),
    "crop_identity": (["commodity_code"], "This crop's usual behaviour in past data"),
    "distance": (["horizon_days"], "How many days ahead"),
    "swings": (["volatility_30", "spread_ratio"], "Recent price swings"),
    "calendar_noise": (["week_of_year", "day_of_week"], "Week number and day of the week"),
}
TITLES = {"supply": "Supply (arrivals)", "market": "Your selected market", "seasonal": "Seasonal pattern",
          "trend": "Recent price trend", "last_year": "Compared with last year", "weather": "Weather",
          "other": "Other model factors"}
CARD_ORDER = ["supply", "market", "seasonal", "trend", "last_year", "weather"]
MAX_CARDS = 4
SUPPLY_MECHANISM_PCT = 10.0     # arrivals must differ from the earlier-year level by this much to state a mechanism
TREND_READING_PCT = 2.0         # a 30-day change smaller than this has no simple reading
SEASON_READING_PCT = 1.0
MIN_DIRECTION_MOVES = 100       # direction accuracy is quoted only with at least this many moves behind it
MIN_CELL_CASES = 300
RANGE_OK_COVERAGE = 75.0
MIN_RANGE_COVERAGE_TO_SHOW = 40.0   # below this measured coverage the range is not shown at all
BANDS = ["1-7", "8-14", "15-30", "31-60"]
METHOD = ("SHAP values of the model are summed per group in log space; the predicted change in rupees is split in "
          "proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects "
          "and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.")


# ----------------------------------------------------------------------------- small helpers
def band_name(h: int) -> str:
    return BANDS[0 if h <= 7 else 1 if h <= 14 else 2 if h <= 30 else 3]


def _ok(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def d_(d: date) -> str:
    return f"{d.day} {SHORT[d.month - 1]} {d.year}"


def range_(a: date, b: date) -> str:
    if a.year == b.year and a.month == b.month:
        return f"{a.day}–{b.day} {SHORT[b.month - 1]} {b.year}"
    if a.year == b.year:
        return f"{a.day} {SHORT[a.month - 1]}–{b.day} {SHORT[b.month - 1]} {b.year}"
    return f"{d_(a)}–{d_(b)}"


def rs(v: float) -> str:
    return f"₹{abs(v):,.0f}"


def signed_pct(p: float) -> str:
    return "about unchanged" if abs(p) < 0.5 else f"{p:+.0f}%"


def round_inr(v: float) -> int:
    """Rounded for display only (the exact value is also returned and is what adds up)."""
    a = abs(v)
    step = 1 if a < 20 else 5 if a < 100 else 10 if a < 1000 else 50
    return int(round(v / step) * step)


def _amount(a: float) -> str:
    return f"{a:,.1f}" if a < 10 else f"{a:,.0f}"


def group_of(feature: str) -> str:
    for g, fs in GROUP_FEATURES.items():
        if feature in fs:
            return g
    return "other"


def other_part_of(feature: str) -> str:
    for p, (fs, _) in OTHER_PARTS.items():
        if feature in fs:
            return p
    return "additional"


# ----------------------------------------------------------------------------- ₹ allocation
def allocate_inr(contrib: dict[str, float], base_value: float, start: float) -> dict:
    """Split dP = start*(exp(L)-1) over the features and the baseline (they add up to dP exactly)."""
    L = float(base_value) + sum(contrib.values())
    factor = math.expm1(L) / L if abs(L) > 1e-9 else 1.0
    per_feature = {f: start * s * factor for f, s in contrib.items()}
    base_inr = start * float(base_value) * factor
    return {"L": L, "factor": factor, "per_feature": per_feature, "base_inr": base_inr,
            "change_inr": start * math.expm1(L)}


# ----------------------------------------------------------------------------- evidence sentences
def _supply(f: dict | None, crop: str, market: str, is_state: bool):
    if not f:
        return None, None, None, "No arrivals were reported in the 30 days before the start date."
    scope = "across the markets that reported" if is_state else f"at {market}"
    win = range_(f["start"], f["end"])
    if f.get("usual") is None:
        return (f"Reported arrivals {scope}, {win}: {_amount(f['mean'])} a day (as reported). No earlier-year "
                f"{MONTHS[f['month'] - 1]} records exist to compare with."), None, None, None
    pct = f["pct"]
    yrs = " and ".join(str(y) for y in sorted(f["usual_years"])) if len(f["usual_years"]) <= 2 else f"{min(f['usual_years'])}–{max(f['usual_years'])}"
    rel = "close to" if abs(pct) < 5 else f"{abs(pct):.0f}% {'above' if pct > 0 else 'below'}"
    text = (f"Reported arrivals {scope}, {win}: {_amount(f['mean'])} a day (as reported), {rel} the "
            f"{MONTHS[f['month'] - 1]} average of {yrs} ({_amount(f['usual'])} a day).")
    mech, reading = None, None
    if pct >= SUPPLY_MECHANISM_PCT:
        mech, reading = "More supply usually lowers prices.", "down"
    elif pct <= -SUPPLY_MECHANISM_PCT:
        mech, reading = "Less supply usually supports prices.", "up"
    return text, mech, reading, None


def _market(f: dict | None, crop: str, market: str, is_state: bool):
    if is_state:
        return None, None, None, f"This forecast is for the Maharashtra median, so no single-market comparison applies."
    if not f:
        return None, None, None, f"Not enough overlapping reports of {market} and the Maharashtra median in the 90 days before the start date."
    gap = f["avg_gap_pct"]
    rel = "close to" if abs(gap) < 1 else f"{abs(gap):.0f}% {'above' if gap > 0 else 'below'}"
    return (f"{market}'s price averaged {rel} the Maharashtra median for {crop} over {range_(f['start'], f['end'])} "
            f"(₹{f['market_avg']:,.0f} vs ₹{f['state_avg']:,.0f}, {f['n_days']} reporting days)."), None, None, None


def _seasonal(f: dict | None, crop: str):
    if not f or not f.get("years"):
        return None, None, None, "No earlier-year records cover this period."
    parts = [f"in {y['year']} the price changed {y['pct']:+.0f}% between {d_(y['from'])} and {d_(y['to'])}" for y in sorted(f["years"], key=lambda x: -x["year"])]
    text = f"{crop}: " + "; ".join(parts) + (f" (average {f['mean_pct']:+.0f}%)." if len(f["years"]) > 1 else ".")
    text = text[0].upper() + text[1:]
    signs = {1 if y["pct"] > 0 else -1 for y in f["years"] if abs(y["pct"]) >= 0.5}
    reading = None
    if abs(f["mean_pct"]) >= SEASON_READING_PCT and len(signs) == 1:
        reading = "up" if f["mean_pct"] > 0 else "down"
    if len(f["years"]) == 1:
        text += " Only one earlier year is available, so this is weak evidence."
    return text, None, reading, None


def _trend(f: dict | None):
    if not f or f.get("d30") is None:
        return None, None, None, "Not enough continuous price reports in the 30 days before the start date."
    t = (f"Price on {d_(f['date'])}: ₹{f['price']:,.0f}; {signed_pct(f['d30']['pct'])} since {d_(f['d30']['date'])} (30 days)")
    if f.get("d90"):
        t += f" and {signed_pct(f['d90']['pct'])} since {d_(f['d90']['date'])} (90 days)"
    reading = None
    if abs(f["d30"]["pct"]) >= TREND_READING_PCT:
        reading = "up" if f["d30"]["pct"] > 0 else "down"
    return t + ".", None, reading, None


def _last_year(f: dict | None):
    if not f:
        return None, None, None, "No price record exists for the same date one year earlier."
    rel = "about the same as" if abs(f["pct"]) < 1 else f"{abs(f['pct']):.0f}% {'higher' if f['pct'] > 0 else 'lower'} than"
    return (f"Price on {d_(f['date'])}: ₹{f['price']:,.0f}, {rel} on {d_(f['prev_date'])} (₹{f['prev_price']:,.0f})."), None, None, None


def _weather(values: dict, status: str):
    if status != "used":
        return None, None, None, "Weather is not used by this forecast."
    return None, None, None, None


_POINTS = {
    "supply": {"up": "Arrivals below the usual level normally go with higher prices",
               "down": "Arrivals above the usual level normally go with lower prices"},
    "seasonal": {"up": "In earlier years prices rose over this period", "down": "In earlier years prices fell over this period"},
    "trend": {"up": "The price has been rising recently", "down": "The price has been falling recently"},
}


def _agreement(group: str, reading: str | None, pushed: str, evidence_text: str | None) -> dict:
    """Do the measured records and the model's push point the same way? (only where a simple reading exists)"""
    if evidence_text is None:
        return {"flag": "no_evidence", "text": "No comparable records, so the evidence cannot be compared with the model's push."}
    if reading is None or group not in _POINTS:
        return {"flag": "no_reading", "text": "These records are shown for information; by themselves they do not point clearly to higher or lower prices."}
    way = "higher" if pushed == "up" else "lower"
    point = _POINTS[group][reading]
    if (reading == "up") == (pushed == "up"):
        return {"flag": "agree", "text": f"{point}, and the model pushed the forecast {way}."}
    return {"flag": "disagree", "text": f"{point}, but the model pushed the forecast {way}. The reason is not visible from the records shown."}


# ----------------------------------------------------------------------------- main
def _trust_block(cell, crop, band, baseline_label, reliability_scope, projected):
    lines, warnings = [], []
    trust = {"scenario": reliability_scope, "cell": f"{crop}|{band}", "available": cell is not None}
    if cell:
        n = cell["n"]
        base_name = cell.get("baseline", baseline_label)
        lines.append(f"In {n:,} backtest forecasts for {crop}, {band} days ahead, the average miss was about ₹{cell['mae']:,.0f} per quintal "
                     f"({cell['wape_pct']:.0f}%); the baseline “{base_name}” missed by ₹{cell['baseline_mae']:,.0f}.")
        lines.append("The model beat that baseline here." if cell["beats_baseline"] else
                     "The model did NOT beat that baseline here, so no rise or fall is claimed.")
        if cell.get("direction_acc_pct") is not None and cell.get("n_meaningful_moves", 0) >= MIN_DIRECTION_MOVES:
            lines.append(f"It called the direction right in {cell['direction_acc_pct']:.0f}% of the {cell['n_meaningful_moves']:,} cases where the price moved by more than 5% "
                         f"({cell['up_share_of_moves_pct']:.0f}% of those moves were rises).")
        else:
            lines.append("Too few large price moves were available to say how often the direction is right.")
        lines.append(f"The 80% range contained the actual price in {cell['range_coverage_pct']:.0f}% of these forecasts (it should be about 80%).")
        if cell["range_coverage_pct"] < RANGE_OK_COVERAGE:
            warnings.append(f"The range was too narrow in past tests: actual prices fell outside it {100 - cell['range_coverage_pct']:.0f}% of the time, so treat it as a minimum spread.")
        if n < MIN_CELL_CASES:
            warnings.append("This rests on few backtest cases, so treat it with caution.")
        trust.update({"n": n, "mae": cell["mae"], "wape_pct": cell["wape_pct"], "baseline": base_name, "baseline_mae": cell["baseline_mae"],
                      "beats_baseline": cell["beats_baseline"], "direction_acc_pct": cell.get("direction_acc_pct"),
                      "n_meaningful_moves": cell.get("n_meaningful_moves"), "range_coverage_pct": cell["range_coverage_pct"],
                      "range_mean_width_pct": cell.get("range_mean_width_pct_of_start")})
    else:
        lines.append("No backtest results are available for this crop and distance, so no reliability figure is given.")
    if reliability_scope == "projection" or projected:
        warnings.append("These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices.")
    trust.update({"lines": lines, "warnings": warnings})
    return trust


CONTEXT_ORDER = ["supply", "market", "trend", "last_year", "seasonal"]


def _context_only(*, facts, values, crop, market, requested_market, series_is_state, horizon, start_price, lower, upper, target_date,
                  projected, forecast_date, ref_origin_date, inflation_pct, cell, band, baseline_label, reason, source_note,
                  recon, reliability_scope, mae_inr) -> dict:
    """Records as dated context, with NO model effects (the model is not used to claim a direction for this crop/cell)."""
    why = reason or (f"In backtests the model did not beat “{baseline_label}” for {crop}, {band} days ahead, so the model is not used to predict a rise or fall.")
    headline = f"No clear direction for {crop} by {d_(target_date)}. {why} The records below are context only."
    ev_fn = {"supply": lambda: _supply(facts.get("supply"), crop, market, series_is_state),
             "market": lambda: _market(facts.get("market"), crop, market, series_is_state),
             "trend": lambda: _trend(facts.get("trend")), "last_year": lambda: _last_year(facts.get("last_year")),
             "seasonal": lambda: _seasonal(facts.get("seasonal"), crop)}
    cards = []
    for g in CONTEXT_ORDER:
        if g == "market" and series_is_state:
            continue
        text, _mech, _reading, missing = ev_fn[g]()
        title = TITLES[g] if not (g == "market" and series_is_state) else "Maharashtra median prices"
        cards.append({"group": g, "title": title, "direction": None, "inr_effect": None, "inr_effect_rounded": None, "log_contribution": None,
                      "effect_text": "Shown as context. It is not used to claim a rise or fall.", "evidence": text if text is not None else missing,
                      "evidence_available": text is not None, "mechanism": None,
                      "agreement": {"flag": "context", "text": "No model push is shown for this crop; these records are for information."}})
    mkt = {"applicable": False, "text": "This forecast is for the Maharashtra median, so there is no single-market premium." if series_is_state
           else "Not enough overlapping reports to compare this market with the Maharashtra median."}
    mf = facts.get("market")
    if mf and not series_is_state:
        diff = mf["market_avg"] - mf["state_avg"]
        mkt = {"applicable": True, "context_only": True, "market": market,
               "text": (f"Over {range_(mf['start'], mf['end'])}, {market} averaged ₹{mf['market_avg']:,.0f} against ₹{mf['state_avg']:,.0f} at the median "
                        f"Maharashtra market: a premium of {'+' if diff >= 0 else '−'}₹{abs(diff):,.0f} (recorded prices, not a forecast)."),
               "evidence": f"{market} traded {abs(mf['avg_gap_pct']):.0f}% {'above' if mf['avg_gap_pct'] >= 0 else 'below'} the Maharashtra median over that period."}
    if requested_market and requested_market != market:
        mkt["note"] = f"You selected {requested_market}, but {source_note or 'its own prices were not recent enough'}; the figures use {market}."
    banner = None
    if projected:
        banner = {"text": f"No {forecast_date.year} market data yet — this forecast replays the same season of {ref_origin_date.year}.",
                  "detail": (f"The starting price is the {d_(ref_origin_date)} price"
                             + (f" plus {inflation_pct:.0f}% for a year's inflation" if _ok(inflation_pct) else "") + ". "
                             f"Every figure below is dated from {ref_origin_date.year} records."),
                  "reference_date": ref_origin_date.isoformat()}
    return {
        "schema_version": 3, "method": METHOD, "context_only": True, "context_reason": why,
        "headline": {"code": "no_clear_direction", "text": headline, "predicted_price": None, "start_price": round(start_price, 2),
                     "change_inr": None, "change_pct": None, "typical_miss_inr": None if mae_inr is None else round(mae_inr, 2),
                     "range": None, "range_hidden": False, "range_coverage_pct": None, "target_date": target_date.isoformat(),
                     "horizon_days": horizon, "band": band},
        "banner": banner, "cards": cards, "other_factors": None, "evidence_not_used_by_model": [],
        "market_breakdown": mkt, "trust": _trust_block(cell, crop, band, baseline_label, reliability_scope, projected),
        "checks": {"inr_sum": None, "predicted_change_inr": None, "reconstruction_error": None if recon is None else round(recon, 8)},
    }


def build_v3(*, contrib: dict[str, float], base_value: float, values: dict, model_features: set[str], facts: dict,
             crop: str, market: str, requested_market: str | None, series_is_state: bool, horizon: int, start_price: float,
             predicted_price: float, lower: float | None, upper: float | None, target_date: date, projected: bool,
             forecast_date: date, ref_origin_date: date, inflation_pct: float | None, reliability_cell: dict | None,
             reliability_scope: str | None, fallback_mae: float | None, fallback_beats: bool | None,
             breakdown: dict | None, weather_status: str = "not_used", model_output_log: float | None = None,
             source_note: str | None = None, baseline_label: str = "price stays unchanged",
             context_only: bool = False, context_reason: str | None = None) -> dict:
    alloc = allocate_inr(contrib, base_value, start_price)
    dP = alloc["change_inr"]
    pct_change = (math.expm1(alloc["L"])) * 100

    # ---- group sums (log + rupees)
    g_log = {g: 0.0 for g in GROUP_FEATURES}
    g_inr = {g: 0.0 for g in GROUP_FEATURES}
    other_inr = {p: 0.0 for p in list(OTHER_PARTS) + ["additional"]}
    other_log_total = 0.0
    for f, s in contrib.items():
        g = group_of(f)
        if g == "other":
            other_inr[other_part_of(f)] += alloc["per_feature"][f]
            other_log_total += s
        elif g == "market" and series_is_state:
            other_inr["crop_identity"] += alloc["per_feature"][f]      # no single market to compare: this is the series' usual behaviour
            other_log_total += s
        else:
            g_log[g] += s
            g_inr[g] += alloc["per_feature"][f]
    used_groups = {g for g, fs in GROUP_FEATURES.items() if any(f in model_features for f in fs)}

    # ---- trust numbers for this crop x band
    cell = reliability_cell
    mae_inr = cell["mae"] if cell else fallback_mae
    beats = cell["beats_baseline"] if cell else fallback_beats
    band = band_name(horizon)
    baseline_label = cell.get("baseline", baseline_label) if cell else baseline_label
    if beats is False:
        code = "no_clear_direction"
        headline = (f"No clear direction for {crop} by {d_(target_date)}: in backtests the model did not beat "
                    f"“{baseline_label}” for {crop}, {band} days ahead, so a rise or fall is not claimed.")
    elif mae_inr is not None and abs(dP) < mae_inr:
        code = "about_the_same"
        headline = (f"About the same: the model's expected change for {crop} (₹{abs(dP):,.0f}) is smaller than its typical "
                    f"miss in backtests (about ₹{mae_inr:,.0f} per quintal at this distance), so no rise or fall is claimed.")
    elif mae_inr is None:
        code = "no_clear_direction"
        headline = f"No clear direction for {crop} by {d_(target_date)}: no backtest results exist for this crop and distance."
    else:
        code = "rise" if dP > 0 else "fall"
        headline = (f"The model expects {crop} to {'rise' if dP > 0 else 'fall'} by about ₹{abs(dP):,.0f} per quintal "
                    f"({pct_change:+.1f}%) by {d_(target_date)}.")

    if context_only:
        return _context_only(facts=facts, values=values, crop=crop, market=market, requested_market=requested_market,
                             series_is_state=series_is_state, horizon=horizon, start_price=start_price, lower=lower, upper=upper,
                             target_date=target_date, projected=projected, forecast_date=forecast_date,
                             ref_origin_date=ref_origin_date, inflation_pct=inflation_pct, cell=cell, band=band,
                             baseline_label=baseline_label, reason=context_reason, source_note=source_note,
                             recon=None if model_output_log is None else abs(alloc["L"] - float(model_output_log)),
                             reliability_scope=reliability_scope, mae_inr=mae_inr)

    # ---- reason cards
    cards, unused = [], []
    ev_fn = {
        "supply": lambda: _supply(facts.get("supply"), crop, market, series_is_state),
        "market": lambda: _market(facts.get("market"), crop, market, series_is_state),
        "seasonal": lambda: _seasonal(facts.get("seasonal"), crop),
        "trend": lambda: _trend(facts.get("trend")),
        "last_year": lambda: _last_year(facts.get("last_year")),
        "weather": lambda: _weather(values, weather_status),
    }
    for g in CARD_ORDER:
        if g == "market" and series_is_state:
            continue
        text, mech, reading, missing = ev_fn[g]()
        if g not in used_groups:
            if text is not None:
                unused.append({"group": g, "title": TITLES[g], "evidence": text,
                               "note": "Measured from the records, but the forecast model does not use it, so it did not move this forecast."})
            continue
        if g == "weather" and weather_status != "used":
            continue
        inr = g_inr[g]
        pushed = "up" if inr > 0 else "down"
        agree = _agreement(g, reading, pushed, text)
        if abs(inr) < 5 and agree["flag"] in ("agree", "disagree"):
            agree = {"flag": "negligible", "text": "The model gave this almost no weight, so there is nothing to compare."}
        effect = ("had almost no effect on the forecast" if abs(inr) < 5 else
                  f"pushed the forecast {pushed} by about {rs(round_inr(inr))}")
        cards.append({
            "group": g, "title": TITLES[g] if not (g == "market" and series_is_state) else "Maharashtra median prices",
            "direction": pushed, "inr_effect": round(inr, 2), "inr_effect_rounded": round_inr(inr), "effect_text": f"{TITLES[g] if not (g == 'market' and series_is_state) else 'Maharashtra median prices'} {effect}.",
            "log_contribution": round(g_log[g], 6), "evidence": text if text is not None else missing,
            "evidence_available": text is not None, "mechanism": mech if (mech and agree["flag"] not in ("no_evidence", "negligible")) else None,
            "agreement": agree})
    cards.sort(key=lambda c: abs(c["inr_effect"]), reverse=True)
    shown, hidden = cards[:MAX_CARDS], cards[MAX_CARDS:]

    # ---- other factors (always reported with its ₹ share)
    parts = []
    for p, (fs, label) in OTHER_PARTS.items():
        parts.append({"label": label, "inr": round(other_inr[p], 2), "meaning": None})
    parts.append({"label": "Additional model factors", "inr": round(other_inr["additional"], 2), "meaning": None})
    parts.append({"label": "The model's usual drift over past data (baseline)", "inr": round(alloc["base_inr"], 2), "meaning": None})
    for c in hidden:
        parts.append({"label": c["title"], "inr": c["inr_effect"], "meaning": None})
    other_total = sum(p["inr"] for p in parts)
    swing = facts.get("swings")
    swing_text = None
    if swing:
        swing_text = (f"Over the 30 days to {d_(swing['date'])} the price typically moved about {swing['daily_pct']:.1f}% from one reported day to the next.")
    other = {"inr_total": round(other_total, 2), "inr_total_rounded": round_inr(other_total),
             "text": f"Other factors: {'+' if other_total >= 0 else '−'}{rs(round_inr(other_total))}",
             "parts": [p for p in parts if abs(p["inr"]) >= 0.5], "swing_evidence": swing_text,
             "note": "Price level, the crop's usual pattern in past data, days ahead, recent swings and the model's baseline drift. "
                     "The model gives no reason for these beyond the patterns it learned, so none is claimed."}

    # ---- market vs Maharashtra
    mkt = None
    if breakdown and not series_is_state and breakdown.get("state_price") is not None:
        prem = predicted_price - breakdown["state_price"]
        mkt = {"applicable": True, "median_market_price": round(breakdown["state_price"], 2),
               "selected_market_price": round(predicted_price, 2), "premium_inr": round(prem, 2),
               "market": market, "target_date": target_date.isoformat(),
               "text": (f"At the median Maharashtra market: ₹{breakdown['state_price']:,.0f}. {market} premium: "
                        f"{'+' if prem >= 0 else '−'}₹{abs(prem):,.0f} (forecasts for {d_(target_date)}).")}
        mf = facts.get("market")
        if mf:
            mkt["evidence"] = (f"{market} traded {abs(mf['avg_gap_pct']):.0f}% {'above' if mf['avg_gap_pct'] >= 0 else 'below'} "
                               f"the Maharashtra median over {range_(mf['start'], mf['end'])}.")
    else:
        mkt = {"applicable": False, "text": ("This forecast is for the Maharashtra median, so there is no single-market premium." if series_is_state
                                              else "A median-market forecast could not be produced for comparison.")}
    if requested_market and requested_market != market:
        mkt["note"] = f"You selected {requested_market}, but {source_note or 'its own prices were not recent enough'}; the figures use {market}."

    # ---- trust block
    lines, warnings = [], []
    trust = {"scenario": reliability_scope, "cell": f"{crop}|{band}", "available": cell is not None}
    if cell:
        n = cell["n"]
        base_name = cell.get("baseline", baseline_label)
        lines.append(f"In {n:,} backtest forecasts for {crop}, {band} days ahead, the average miss was about ₹{cell['mae']:,.0f} per quintal "
                     f"({cell['wape_pct']:.0f}%); the baseline “{base_name}” missed by ₹{cell['baseline_mae']:,.0f}.")
        lines.append("The model beat that baseline here." if cell["beats_baseline"] else
                     "The model did NOT beat that baseline here, so no rise or fall is claimed.")
        if cell.get("direction_acc_pct") is not None and cell.get("n_meaningful_moves", 0) >= MIN_DIRECTION_MOVES:
            lines.append(f"It called the direction right in {cell['direction_acc_pct']:.0f}% of the {cell['n_meaningful_moves']:,} cases where the price moved by more than 5% "
                         f"({cell['up_share_of_moves_pct']:.0f}% of those moves were rises).")
        else:
            lines.append("Too few large price moves were available to say how often the direction is right.")
        lines.append(f"The 80% range contained the actual price in {cell['range_coverage_pct']:.0f}% of these forecasts "
                     f"(it should be about 80%).")
        if cell["range_coverage_pct"] < RANGE_OK_COVERAGE:
            warnings.append(f"The range was too narrow in past tests: actual prices fell outside it {100 - cell['range_coverage_pct']:.0f}% of the time, so treat it as a minimum spread.")
        if n < MIN_CELL_CASES:
            warnings.append("This rests on few backtest cases, so treat it with caution.")
        trust.update({"n": n, "mae": cell["mae"], "wape_pct": cell["wape_pct"], "baseline": base_name, "baseline_mae": cell["baseline_mae"],
                      "beats_baseline": cell["beats_baseline"], "direction_acc_pct": cell.get("direction_acc_pct"),
                      "n_meaningful_moves": cell.get("n_meaningful_moves"), "range_coverage_pct": cell["range_coverage_pct"],
                      "range_mean_width_pct": cell.get("range_mean_width_pct_of_start")})
    else:
        lines.append("No backtest results are available for this crop and distance, so no reliability figure is given.")
    if reliability_scope == "projection" or projected:
        warnings.append("These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices.")
    trust.update({"lines": lines, "warnings": warnings})

    # ---- banner / dates
    banner = None
    if projected:
        banner = {"text": f"No {forecast_date.year} market data yet — this forecast replays the same season of {ref_origin_date.year}.",
                  "detail": (f"The starting price is the {d_(ref_origin_date)} price"
                             + (f" plus {inflation_pct:.0f}% for a year's inflation" if _ok(inflation_pct) else "") + ". "
                             f"Every figure below is dated from {ref_origin_date.year} records."),
                  "reference_date": ref_origin_date.isoformat()}

    recon = None if model_output_log is None else abs(alloc["L"] - float(model_output_log))
    range_hidden = bool(cell and cell["range_coverage_pct"] < MIN_RANGE_COVERAGE_TO_SHOW)
    return {
        "schema_version": 3, "method": METHOD,
        "headline": {"code": code, "text": headline, "predicted_price": round(predicted_price, 2), "start_price": round(start_price, 2),
                     "change_inr": round(dP, 2), "change_pct": round(pct_change, 2), "typical_miss_inr": None if mae_inr is None else round(mae_inr, 2),
                     "range": None if (lower is None or range_hidden) else [round(lower, 2), round(upper, 2)],
                     "range_hidden": range_hidden, "range_coverage_pct": None if not cell else cell["range_coverage_pct"],
                     "target_date": target_date.isoformat(), "horizon_days": horizon, "band": band},
        "banner": banner, "cards": shown, "other_factors": other, "evidence_not_used_by_model": unused,
        "market_breakdown": mkt, "trust": trust,
        "checks": {"inr_sum": round(sum(c["inr_effect"] for c in shown) + other_total, 6), "predicted_change_inr": round(dP, 6),
                   "reconstruction_error": None if recon is None else round(recon, 8)},
    }
