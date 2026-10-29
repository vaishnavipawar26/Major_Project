"""The 30-day selling window of a forecast: one entry per day (60 calendar days after the forecast start), the planned date's price and the best other date.

Everything is read from the daily path the forecaster already produced (``chart_path``: one model prediction per day, each from data
known at the forecast origin). Nothing is interpolated or invented. A day whose prediction is missing, not a positive finite number, or
not validated by the backtests for this crop and distance (``beats_baseline`` false) is returned with an explicit status and is never
used for a comparison, so a recommendation only ever compares predictions the app is willing to show.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from app.ml.price_prediction.freshness import FRESH_DATASET_DAYS

WINDOW_DAYS = 60   # convention: the forecast start date is day 0; the window is the 60 calendar days AFTER it (start+1 .. start+60)

VALIDATED = "validated"
NOT_VALIDATED = "not_validated"
UNAVAILABLE = "unavailable"


def _valid_price(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def _status(point: dict | None) -> str:
    if point is None or not _valid_price(point.get("predicted_price")):
        return UNAVAILABLE
    return VALIDATED if point.get("beats_baseline") else NOT_VALIDATED


def _reason(point: dict | None, d: date, f: dict) -> str | None:
    """Why this day has no validated price (None when it is validated). Backend wording, one reason per day."""
    st = _status(point)
    if st == VALIDATED:
        return None
    if st == NOT_VALIDATED:
        return (point.get("validation_reason")
                or "Past tests did not show the model beating the 'price stays the same' forecast for this crop at this distance.")
    origin, mh = f.get("forecast_origin_date"), f.get("max_horizon_days")
    if origin and mh and (d - date.fromisoformat(origin)).days > mh:
        return (f"The model forecasts at most {mh} days after the market's latest report ({date.fromisoformat(origin):%d %b %Y}); "
                "this date is further away, so no prediction exists for it.")
    return "The model produced no usable price for this date."


def _uncertainty(point: dict | None, ok: bool) -> dict:
    """What is known about this day's range. A range whose measured coverage (backtests of the same crop, distance and scenario) is below the
    display threshold is withheld: it would look like a confidence interval while the real price usually fell outside it."""
    if not ok:
        return {"coverage_pct": None, "scope": None, "shown": False, "measured": False,
                "note": "No prediction exists for this date, so there is no range."}
    cov, scope = point.get("range_coverage_pct"), point.get("range_scope")
    shown = point.get("range_shown", True) is not False
    where = "starting from last year's prices" if scope == "projection" else "starting from a recent reported price"
    if cov is None:
        note = "This range has not been checked against past prices; treat it as a rough spread, not a tested interval."
    elif shown:
        note = f"In past tests ({where}), the real price fell inside the 80% range {cov:.0f}% of the time."
    else:
        note = (f"No range is given: in past tests ({where}), the real price fell inside the model's 80% range only {cov:.0f}% of the time, "
                "so the range would not be reliable.")
    return {"coverage_pct": cov, "scope": scope, "shown": shown, "measured": cov is not None, "note": note}


def _day(d: date, point: dict | None, n: int, f: dict | None = None) -> dict:
    status = _status(point)
    ok = status != UNAVAILABLE
    f = f or {}
    src, ser = f.get("source") or {}, f.get("series") or {}
    unc = _uncertainty(point, ok)
    return {"date": d.isoformat(), "day": n, "status": status,
            "predicted_price": point["predicted_price"] if ok else None,
            "lower": point.get("lower") if unc["shown"] else None, "upper": point.get("upper") if unc["shown"] else None,
            "uncertainty": unc,
            "crop": ser.get("commodity"), "market": src.get("used_market") or ser.get("market"),
            # the three kinds the page must keep apart: a validated forecast, an experimental (unvalidated) estimate, no prediction
            "series": {VALIDATED: "validated", NOT_VALIDATED: "experimental", UNAVAILABLE: "unavailable"}[status],
            "model": point.get("model") if ok else None, "horizon_days": point.get("horizon_days") if ok else None,
            "reason": _reason(point, d, f)}


def _deadline(planned: dict | None, hold_days: int | None) -> str | None:
    """Storage deadline = the planned selling date + the days the crop can practically be held (None: no limit known)."""
    if planned is None or hold_days is None:
        return None
    return (date.fromisoformat(planned["date"]) + timedelta(days=hold_days)).isoformat()


def _days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def compare(planned: dict | None, days: list[dict], hold_days: int | None = None) -> dict:
    """The planned date against the highest validated price in the window.

    ``hold_days`` = how many days AFTER THE PLANNED DATE the crop can practically be held with the farmer's storage (None: no limit).
    The storage deadline is the planned date + ``hold_days``. Dates up to the deadline (earlier dates, the planned date itself, and later
    dates inside the limit) are eligible; a higher price after the deadline is reported as ``beyond_storage`` and never recommended.
    ``highest`` is the highest validated price in the whole window and whether it is within the deadline, so the page can show the
    highest price and the recommended date separately.

    ``planned`` = {"date", "price", "status"} or None. ``code``:
      planned_is_best  the planned date has the highest validated price of the window (ties go to the earlier date)
      alternative      another date has a higher validated price
      unavailable      no validated price for the planned date or for any other date, so nothing can be compared
    """
    validated = [d for d in days if d["status"] == VALIDATED]
    deadline = _deadline(planned, hold_days)
    keeps = lambda d: deadline is None or d["date"] <= deadline  # noqa: E731
    pool = [d for d in validated if keeps(d)]
    best = None
    for d in pool:                       # strictly greater: the earliest date wins a tie
        if best is None or d["predicted_price"] > best["predicted_price"]:
            best = d
    later = max((d for d in validated if not keeps(d)), key=lambda d: d["predicted_price"], default=None)
    beyond = ({"date": later["date"], "price": later["predicted_price"]}
              if later and best and later["predicted_price"] > best["predicted_price"] else None)
    if planned is None or planned.get("status") != VALIDATED or best is None:
        reason = ("planned_not_validated" if planned is not None and planned.get("status") != VALIDATED else
                  "no_validated_dates")
        return {"code": "unavailable", "reason": reason, "date": None, "price": None, "diff": None, "diff_pct": None, "wait_days": None,
                "deadline": deadline, "days_left": None, "highest": None}
    top = None
    for d in validated:                  # strictly greater: the earliest date wins a tie
        if top is None or d["predicted_price"] > top["predicted_price"]:
            top = d
    highest = {"date": top["date"], "price": top["predicted_price"], "within_storage": keeps(top)}
    chosen = planned if (best["date"] == planned["date"] or best["predicted_price"] <= planned["price"]) else best
    left = None if deadline is None else _days_between(chosen["date"], deadline)   # storage days still left on the day the crop is sold
    if chosen is planned:
        return {"code": "planned_is_best", "reason": None, "date": planned["date"], "price": planned["price"],
                "diff": 0.0, "diff_pct": 0.0, "wait_days": 0, "beyond_storage": beyond, "deadline": deadline, "days_left": left, "highest": highest}
    diff = round(best["predicted_price"] - planned["price"], 2)
    pct = round(diff / planned["price"] * 100, 2) if planned["price"] > 0 else None
    wait = _days_between(planned["date"], best["date"])
    return {"code": "alternative", "reason": None, "date": best["date"], "price": best["predicted_price"],
            "diff": diff, "diff_pct": pct, "wait_days": wait, "beyond_storage": beyond, "deadline": deadline, "days_left": left, "highest": highest}


def _experimental(entries: list[dict], planned: dict, inside: bool, hold_days: int | None, comparison: dict) -> dict | None:
    """The same planned-vs-best comparison on the model's raw estimates for days that did NOT pass the accuracy tests. Only built when no
    validated comparison exists, and always labelled experimental: it is the model's unvalidated output, never a recommendation."""
    if comparison["code"] in ("alternative", "planned_is_best") or not inside:
        return None
    raw = [{**e, "status": VALIDATED} if e["status"] == NOT_VALIDATED else e for e in entries]
    if not any(e["status"] == NOT_VALIDATED for e in entries):
        return None
    pe = next((e for e in raw if e["date"] == planned["date"]), None)
    if pe is None or pe["status"] != VALIDATED:
        return None
    exp_planned = {"date": pe["date"], "status": VALIDATED, "price": pe["predicted_price"]}
    return {"validated": False, "planned": exp_planned, "comparison": compare(exp_planned, raw, hold_days)}


def _highest_and_change(ds: list[dict], days: int) -> tuple[dict | None, dict | None]:
    """The highest day (ties: the earliest) and the change from the first to the last of ``ds`` (days of ONE status, so the two prices compared
    are the same kind of forecast)."""
    highest = None
    for d in ds:
        if highest is None or d["predicted_price"] > highest["predicted_price"]:
            highest = d
    change = None
    if len(ds) > 1:
        first, last = ds[0], ds[-1]
        diff = last["predicted_price"] - first["predicted_price"]
        change = {"from_date": first["date"], "from_price": first["predicted_price"], "to_date": last["date"], "to_price": last["predicted_price"],
                  "abs": round(diff, 2), "pct": round(diff / first["predicted_price"] * 100, 2), "is_window_end": last["day"] == days}
    return highest, change


def build_window(f: dict, days: int = WINDOW_DAYS, hold_days: int | None = None, storage: dict | None = None) -> dict:
    """``f`` = a forecast dict (``input_date``, ``target_date``, ``current_price``, ``chart_path``).

    ``storage`` = ``crop_storage.storage_plans(crop)``: one plan per storage facility and produce condition. Every plan is compared on the
    SAME daily entries, so the chart, the highest price and each plan's recommendation always agree. Without it, ``hold_days`` (days after
    the planned date; None = no limit) is used for the single comparison.

    Days run from the forecast start (``input_date``) + 1 to + ``days``. Returns the daily entries, the starting reference price, the
    planned date's entry, the highest validated price and the planned-vs-best comparison."""
    start = date.fromisoformat(f["input_date"])
    planned_date = date.fromisoformat(f["target_date"])
    by_date = {p["date"]: p for p in (f.get("chart_path") or f.get("path") or [])}
    entries = [_day(start + timedelta(days=n), by_date.get((start + timedelta(days=n)).isoformat()), n, f) for n in range(1, days + 1)]
    # a day with no model prediction (past the model's reach) may carry the historical estimate; it stays "unavailable" as a model day
    est = {e["date"]: e["price"] for e in f.get("estimate_path") or [] if _valid_price(e.get("price"))}
    for e in entries:
        e["estimate"] = ({"price": est[e["date"]], "method": "historical_baseline", "validated": False}
                         if e["status"] == UNAVAILABLE and e["date"] in est else None)
    end = start + timedelta(days=days)
    inside = start < planned_date <= end

    # the planned date always reads the same daily prediction as the chart; outside the window it is still shown but never compared
    pd_entry = _day(planned_date, by_date.get(planned_date.isoformat()), (planned_date - start).days, f)
    planned = {"date": planned_date.isoformat(), "status": pd_entry["status"], "price": pd_entry["predicted_price"],
               "lower": pd_entry["lower"], "upper": pd_entry["upper"], "in_window": inside, "estimate": None}
    # a planned date past the model's reach has no model price; the answer's historical estimate for it is carried apart, never as a day
    t = f.get("target") or {}
    if pd_entry["status"] == UNAVAILABLE and t.get("method") == "historical_baseline" and _valid_price(t.get("predicted_price")):
        planned["estimate"] = {"price": t["predicted_price"], "method": "historical_baseline", "validated": False,
                               "reason": t.get("validation_reason")}

    valid = [d for d in entries if d["status"] == VALIDATED]
    highest, change = _highest_and_change(valid, days)
    # without any validated day, the same two figures from the model's experimental (not validated) days, labelled as estimates; they are
    # never put in `highest` / `change`, which stay validated-only (recommendations and comparisons read those)
    estimates = None
    if not valid:
        exp_days = [d for d in entries if d["status"] == NOT_VALIDATED]
        e_high, e_change = _highest_and_change(exp_days, days)
        if e_high:
            estimates = {"kind": "experimental", "validated": False, "days": len(exp_days),
                         "highest": {"date": e_high["date"], "price": e_high["predicted_price"]}, "change": e_change}

    ref = f.get("current_price")
    ref = ref if _valid_price(ref) else None

    proj = f.get("projection")
    src = f.get("source") or {}
    # the starting reference price: a real report, or (when records end before the forecast start) that report moved forward with the app's
    # documented yearly price-level assumption. `adjusted` says which, so the page never shows an adjusted number as a reported price.
    reference = None
    if ref is not None:
        reference = {"price": ref, "market": src.get("used_market"), "adjusted": bool(proj),
                     "reported_price": proj["reference_price"] if proj else ref,
                     "reported_date": proj["reference_origin_date"] if proj else f.get("forecast_origin_date"),
                     "adjustment_pct_per_year": proj["inflation_annual_pct"] if proj else None,
                     "years": proj["years_ahead"] if proj else 0}
        # the newest REAL price of the series and how old it is, so the page can say when the reference is stale (an old price is never presented as current)
        lr = f.get("latest_recorded")
        reference["latest_actual"] = ({"price": lr["price"], "date": lr["date"], "age_days": lr["age_days"]} if lr else None)
        reference["stale"] = bool(lr and lr["age_days"] > FRESH_DATASET_DAYS)

    outside = {"code": "outside_window", "reason": "planned_outside_window", "date": None, "price": None, "diff": None,
               "diff_pct": None, "wait_days": None, "deadline": None, "days_left": None, "highest": None}
    plans_out = None
    if storage:
        plans_out = {}
        for key, plan in storage["plans"].items():
            h = plan["hold_days"]
            c = compare(planned, entries, h) if inside else outside
            plans_out[key] = {**plan, "deadline": _deadline(planned, h), "comparison": c,
                              "experimental": _experimental(entries, planned, inside, h, c)}
        default = plans_out[storage["default"]]
        hold_days, comparison, experimental = default["hold_days"], default["comparison"], default["experimental"]
    else:
        comparison = compare(planned, entries, hold_days) if inside else outside
        experimental = _experimental(entries, planned, inside, hold_days, comparison)
    pol = f.get("policy") or {}
    # why the model's days are (not) shown: the reliability rule's own result for this crop and distance, in the backend's words
    validation = {"mode": pol.get("mode"), "band": pol.get("band"), "reasons": list(pol.get("reasons") or [])[:3],
                  "validated_up_to_days": f.get("last_validated_days"), "method": (f.get("source") or {}).get("method"),
                  "source_kind": (f.get("source") or {}).get("kind"),
                  # the experimental estimates' measured error in a test of the same stale-records situation, with the flat baseline's
                  "stale_test": f.get("stale_test")}
    return {"days": days, "hold_days": hold_days, "validation": validation, "experimental": experimental, "start_date": start.isoformat(), "end_date": end.isoformat(), "reference_price": ref,
            "reference_date": f.get("forecast_origin_date"), "reference": reference, "entries": entries, "planned": planned,
            "highest": ({"date": highest["date"], "price": highest["predicted_price"]} if highest else None), "estimates": estimates,
            "change": change, "comparison": comparison,
            "counts": {"validated": len(valid), "experimental": sum(d["status"] == NOT_VALIDATED for d in entries),
                       "unavailable": sum(d["status"] == UNAVAILABLE for d in entries)},
            "validated_days": len(valid), "unvalidated_days": sum(d["status"] == NOT_VALIDATED for d in entries),
            "unavailable_days": sum(d["status"] == UNAVAILABLE for d in entries),
            "estimated_days": sum(d["estimate"] is not None for d in entries),
            "storage": ({**storage, "plans": plans_out} if storage else None)}
