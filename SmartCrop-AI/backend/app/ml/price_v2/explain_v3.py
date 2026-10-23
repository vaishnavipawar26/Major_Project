"""Farmer-friendly explanation of one candidate forecast, version 3 (pure function, no I/O).

Compared with explain_v2 it fixes the problems found in the Phase 2 samples:
  * evidence ("what the records show") and the model's push ("what moved the forecast") are separate;
    a factor's evidence is never labelled "too weak" - the labels agrees / opposite / evidence_small are
    only used where a defensible simple reading exists (arrivals, seasonal pattern, recent trend), and
    market premium / last-year comparison are marked "no simple reading";
  * "Other model factors" is split into named parts; what cannot be interpreted is labelled honestly;
  * every reliability percentage carries its number of cases, and a direction accuracy is quoted only
    when it rests on at least MIN_CLEAR_FOR_ACCURACY clear forecasts;
  * a price range is shown only when its measured coverage is at least RANGE_MIN_COVERAGE on >= 100 cases;
  * disagreement between the evidence and the model is stated in plain words, without inventing a reason;
  * "No clear direction" whenever the expected change is smaller than the typical error.

Nothing here claims a cause. The words "SHAP", "log" or "encoding" never appear in farmer-facing text.
"""
from __future__ import annotations

import math

from app.ml.price_v2.explain_v2 import (GROUPS, TITLES, _a, _ok, _pct, band_of, evidence_text, reading)

MIN_CLEAR_FOR_ACCURACY = 100     # fewer clear forecasts than this: no accuracy percentage is quoted
MIN_CASES_FOR_RELIABILITY = 300  # fewer backtest cases than this: flagged as "few cases"
RANGE_MIN_COVERAGE = 75.0        # a range is shown only if it contained the actual price this often
MINOR_SHARE = 10.0
READING_GROUPS = ("supply", "seasonal", "recent_trend")

OTHER_PARTS = {
    "price_level": ["log_price"],
    "crop_market": ["commodity_code", "market_code", "variety_code"],
    "distance": ["horizon_days"],
    "price_swings": ["volatility_30", "spread_ratio"],
    "additional": ["day_of_week"],
}
OTHER_TITLES = {
    "price_level": "Current price level",
    "crop_market": "This crop and market's usual behaviour in past data",
    "distance": "How many days ahead the date is",
    "price_swings": "Recent price swings",
    "additional": "Additional model factors",
}
GROUP_TITLES = {**TITLES, **{f"other:{k}": v for k, v in OTHER_TITLES.items()}}


def _swing_text(v: dict) -> str | None:
    vol, sp = v.get("volatility_30"), v.get("spread_ratio")
    if not _ok(vol):
        return None
    s = f"Over the last 30 days the price typically moved about {vol * 100:.1f}% from one reported day to the next"
    if _ok(sp):
        s += f"; on the last day the highest price was {(math.exp(sp) - 1) * 100:.0f}% above the lowest"
    return s + "."


def _other_note(part: str, pushed: str) -> str:
    """What the model did - phrased as the model's learned tendency, never as a real-world reason."""
    way = "higher" if pushed == "higher" else "lower"
    return {
        "price_level": f"The model has learned a tendency for prices at this level; it pushed the forecast {way}.",
        "crop_market": f"The model's usual pattern for this crop and market pushed the forecast {way}.",
        "distance": f"The number of days ahead pushed the forecast {way}.",
        "price_swings": f"The recent swings pushed the forecast {way}; the model does not say why.",
        "additional": f"Additional model factors (such as the day of the week) pushed the forecast {way}; their meaning cannot be explained reliably.",
    }[part]


def _relation(group: str, values: dict, pushed: str) -> str:
    if group not in READING_GROUPS:
        return "no_simple_reading"
    rd = reading(group, values)
    if rd is None:
        return "evidence_small"
    return "agrees" if (rd == "up") == (pushed == "higher") else "opposite"


def _disagreement(group: str, values: dict, pushed: str, crop: str) -> str | None:
    way = "higher" if pushed == "higher" else "lower"
    if group == "supply":
        x = values.get("arr_vs_month_prior")
        return (f"Arrivals were {'above' if x > 0 else 'below'} the usual level, which would normally point to "
                f"{'lower' if x > 0 else 'higher'} prices, but the model pushed the forecast {way}.")
    if group == "seasonal":
        x = values.get("season_change")
        return (f"In earlier years {crop} prices {'rose' if x > 0 else 'fell'} in this period, but the model pushed the forecast {way}.")
    if group == "recent_trend":
        x = values.get("lag_30_change")
        return (f"The price {'rose' if x > 0 else 'fell'} over the last 30 days, but the model pushed the forecast {way}, against that movement.")
    return None


def explain_forecast_v3(shap_row, base_value: float, feature_names: list[str], values: dict, *,
                        crop: str, horizon: int, start_price: float, origin_date: str, shrink_w: float,
                        typical_error_log: float | None, reliability: dict | None,
                        series_is_state: bool = False, projected: bool = False, n_prior_years: int = 0,
                        price_range: tuple[float, float] | None = None, range_coverage: dict | None = None,
                        model_output_log: float | None = None) -> dict:
    """``reliability``: n, mae, wape_pct, skill_vs_no_change_pct, n_clear, n_clear_correct (backtest figures
    for this crop and horizon band). ``range_coverage``: {coverage_pct, n} measured for the range."""
    contrib = {n: float(s) * shrink_w for n, s in zip(feature_names, shap_row)}
    raw_change = float(base_value) + sum(float(s) for s in shap_row)
    pred_log = shrink_w * raw_change
    change_pct = _pct(pred_log)
    pred_price = start_price * math.exp(pred_log)
    err_pct = _pct(typical_error_log) if _ok(typical_error_log) else None

    if shrink_w <= 0:
        code = "no_clear_direction"
        why = (f"In past tests the model added nothing over keeping the latest price for {crop} at this distance.")
    elif err_pct is not None and abs(change_pct) < err_pct:
        code = "no_clear_direction"
        why = (f"The expected change ({change_pct:+.1f}%) is small compared with the model's usual prediction error "
               f"(about {err_pct:.0f}%).")
    else:
        code, why = ("rise" if change_pct > 0 else "fall"), None
    headline = {"rise": f"The model expects {crop}'s price to rise by about {abs(change_pct):.0f}% over {horizon} days.",
                "fall": f"The model expects {crop}'s price to fall by about {abs(change_pct):.0f}% over {horizon} days.",
                "no_clear_direction": f"No clear direction for {crop}'s price over the next {horizon} days."}[code]

    ctx = dict(crop=crop, horizon=horizon, origin_month=int(origin_date[5:7]), series_is_state=series_is_state,
               n_prior_years=n_prior_years)
    sums = {g: sum(contrib.get(f, 0.0) for f in fs) for g, fs in GROUPS.items()}
    used = {f for fs in GROUPS.values() for f in fs}
    other_used = set()
    for part, fs in OTHER_PARTS.items():
        sums[f"other:{part}"] = sum(contrib.get(f, 0.0) for f in fs)
        other_used.update(fs)
    leftover = sum(s for f, s in contrib.items() if f not in used and f not in other_used)
    sums["other:additional"] += leftover
    total_abs = sum(abs(s) for s in sums.values()) or 1.0
    prefix = "Same date last year: " if projected else ""

    records, pushes, disagreements = [], [], []
    for g, s in sums.items():
        share = abs(s) / total_abs * 100
        pushed = "higher" if s > 0 else "lower"
        if g.startswith("other:"):
            part = g.split(":", 1)[1]
            ev = None
            if part == "price_level":
                ev = f"Start price: ₹{start_price:,.0f} per quintal."
            elif part == "price_swings":
                ev = _swing_text(values)
            rel = "no_simple_reading"
            note = _other_note(part, pushed)
        else:
            ev = evidence_text(g, values, **ctx)
            rel = _relation(g, values, pushed)
            note = f"This group pushed the forecast {pushed}."
            if share >= MINOR_SHARE and rel == "opposite":
                d = _disagreement(g, values, pushed, crop)
                if d:
                    disagreements.append(d + " The reason is not visible from the inputs shown.")
        pushes.append({"group": g, "title": GROUP_TITLES[g], "pushed": pushed, "share_pct": round(share, 1),
                       "minor": share < MINOR_SHARE, "relation": rel, "note": note, "evidence_available": ev is not None})
        if ev is not None:
            records.append({"group": g, "title": GROUP_TITLES[g], "text": (prefix + ev[0].lower() + ev[1:]) if prefix else ev})
        elif not g.startswith("other:"):
            records.append({"group": g, "title": GROUP_TITLES[g], "text": "Not available for this forecast (no comparable earlier records)."})
    pushes.sort(key=lambda r: r["share_pct"], reverse=True)

    # reliability text always carries its number of cases
    rel_lines, conf = [], None
    if reliability and reliability.get("n"):
        r = reliability
        band = band_of(horizon)
        few = " This rests on few cases, so treat it with caution." if r["n"] < MIN_CASES_FOR_RELIABILITY else ""
        sk = r.get("skill_vs_no_change_pct")
        cmp_ = ("no better than simply keeping the latest price" if sk is None or sk <= 0
                else f"{sk:.0f}% closer than simply keeping the latest price")
        rel_lines.append(f"In {r['n']:,} backtest forecasts for {crop}, {band} days ahead, the average miss was about "
                         f"₹{r['mae']:.0f} per quintal ({r['wape_pct']:.0f}%), {cmp_}.{few}")
        m, k = int(r.get("n_clear") or 0), int(r.get("n_clear_correct") or 0)
        if m >= MIN_CLEAR_FOR_ACCURACY:
            rel_lines.append(f"When the model gave a clear direction it was right in {k:,} of {m:,} cases ({k / m * 100:.0f}%).")
        elif m > 0:
            rel_lines.append(f"The model gave a clear direction in only {m:,} of these forecasts, too few to say how often it is right.")
        else:
            rel_lines.append("The model rarely gave a clear direction for this crop and distance.")
        conf = {"n_backtest_forecasts": r["n"], "n_clear_forecasts": m, "n_clear_correct": k,
                "direction_accuracy_quoted": m >= MIN_CLEAR_FOR_ACCURACY}
    else:
        rel_lines.append("Not enough backtest results are available to estimate how reliable this forecast is.")

    shown_range = None
    if price_range is not None and range_coverage and range_coverage.get("n", 0) >= 100 \
            and range_coverage.get("coverage_pct", 0) >= RANGE_MIN_COVERAGE:
        shown_range = [round(price_range[0], 2), round(price_range[1], 2)]
        rel_lines.append(f"Likely range ₹{shown_range[0]:,.0f}–₹{shown_range[1]:,.0f}: in backtests such ranges contained the actual price "
                         f"in {range_coverage['coverage_pct']:.0f}% of {range_coverage['n']:,} forecasts.")
    else:
        rel_lines.append("No price range is shown because its accuracy has not been verified well enough.")
    if err_pct is not None:
        rel_lines.append(f"Typical prediction error for this crop and distance: about {err_pct:.0f}%.")
    if projected:
        rel_lines.append("This forecast starts from last year's prices because the price records end before today, so treat it as a seasonal scenario.")

    # concise farmer text
    up = [p for p in pushes if p["pushed"] == "higher" and not p["minor"]]
    down = [p for p in pushes if p["pushed"] == "lower" and not p["minor"]]
    lines = [headline]
    if why:
        lines.append(why)
    lines += ["", "What the records show:"] + [f"- {r['title']}: {r['text']}" for r in records]
    lines += ["", "What moved the forecast:"]
    if up:
        lines.append("- Pushed higher: " + ", ".join(f"{p['title']} ({p['share_pct']:.0f}%)" for p in up))
    if down:
        lines.append("- Pushed lower: " + ", ".join(f"{p['title']} ({p['share_pct']:.0f}%)" for p in down))
    lines += [f"- {d}" for d in disagreements]
    lines += ["", "How sure is this?"] + [f"- {x}" for x in rel_lines]
    lines += ["", "This describes what the model did with past records. It does not prove what will cause prices to change."]

    return {
        "headline": headline, "direction": code, "why_no_direction": why,
        "start_price": round(start_price, 2), "predicted_price": round(pred_price, 2),
        "predicted_change_pct": round(change_pct, 2), "typical_error_pct": None if err_pct is None else round(err_pct, 1),
        "price_range": shown_range, "origin_date": origin_date, "horizon_days": horizon, "shrink_weight": shrink_w,
        "records_show": records, "what_moved_forecast": pushes, "disagreements": disagreements,
        "reliability_lines": rel_lines, "reliability_counts": conf, "farmer_text": "\n".join(lines),
        "reconstruction_error": None if model_output_log is None else round(abs(raw_change - float(model_output_log)), 8),
    }
