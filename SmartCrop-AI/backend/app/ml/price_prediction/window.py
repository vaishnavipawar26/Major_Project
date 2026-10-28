"""The 30-day selling window of a forecast: one entry per day, the planned date's price and the best other date.

Everything is read from the daily path the forecaster already produced (``chart_path``: one model prediction per day, each from data
known at the forecast origin). Nothing is interpolated or invented. A day whose prediction is missing, not a positive finite number, or
not validated by the backtests for this crop and distance (``beats_baseline`` false) is returned with an explicit status and is never
used for a comparison, so a recommendation only ever compares predictions the app is willing to show.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

WINDOW_DAYS = 30

VALIDATED = "validated"
NOT_VALIDATED = "not_validated"
UNAVAILABLE = "unavailable"


def _valid_price(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def _status(point: dict | None) -> str:
    if point is None or not _valid_price(point.get("predicted_price")):
        return UNAVAILABLE
    return VALIDATED if point.get("beats_baseline") else NOT_VALIDATED


def _day(d: date, point: dict | None, n: int) -> dict:
    status = _status(point)
    ok = status != UNAVAILABLE
    return {"date": d.isoformat(), "day": n, "status": status,
            "predicted_price": point["predicted_price"] if ok else None,
            "lower": point.get("lower") if ok else None, "upper": point.get("upper") if ok else None}


def compare(planned: dict | None, days: list[dict], hold_days: int | None = None) -> dict:
    """The planned date against the highest validated price in the window.

    ``hold_days`` = how long the crop keeps on an ordinary farm (None: no limit). Dates later than that are not eligible (the planned
    date itself always is); a higher price beyond it is reported as ``beyond_storage`` instead of being recommended.

    ``planned`` = {"date", "price", "status"} or None. ``code``:
      planned_is_best  the planned date has the highest validated price of the window (ties go to the earlier date)
      alternative      another date has a higher validated price
      unavailable      no validated price for the planned date or for any other date, so nothing can be compared
    """
    validated = [d for d in days if d["status"] == VALIDATED]
    keeps = lambda d: hold_days is None or d["day"] <= hold_days or (planned is not None and d["date"] == planned["date"])  # noqa: E731
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
        return {"code": "unavailable", "reason": reason, "date": None, "price": None, "diff": None, "diff_pct": None, "wait_days": None}
    if best["date"] == planned["date"] or best["predicted_price"] <= planned["price"]:
        return {"code": "planned_is_best", "reason": None, "date": planned["date"], "price": planned["price"],
                "diff": 0.0, "diff_pct": 0.0, "wait_days": 0, "beyond_storage": beyond}
    diff = round(best["predicted_price"] - planned["price"], 2)
    pct = round(diff / planned["price"] * 100, 2) if planned["price"] > 0 else None
    wait = (date.fromisoformat(best["date"]) - date.fromisoformat(planned["date"])).days
    return {"code": "alternative", "reason": None, "date": best["date"], "price": best["predicted_price"],
            "diff": diff, "diff_pct": pct, "wait_days": wait, "beyond_storage": beyond}


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


def build_window(f: dict, days: int = WINDOW_DAYS, hold_days: int | None = None) -> dict:
    """``f`` = a forecast dict (``input_date``, ``target_date``, ``current_price``, ``chart_path``).

    Days run from the forecast start (``input_date``) + 1 to + ``days``. Returns the daily entries, the starting reference price, the
    planned date's entry, the highest validated price and the planned-vs-best comparison."""
    start = date.fromisoformat(f["input_date"])
    planned_date = date.fromisoformat(f["target_date"])
    by_date = {p["date"]: p for p in (f.get("chart_path") or f.get("path") or [])}
    entries = [_day(start + timedelta(days=n), by_date.get((start + timedelta(days=n)).isoformat()), n) for n in range(1, days + 1)]
    end = start + timedelta(days=days)
    inside = start < planned_date <= end

    # the planned date always reads the same daily prediction as the chart; outside the window it is still shown but never compared
    pd_entry = _day(planned_date, by_date.get(planned_date.isoformat()), (planned_date - start).days)
    planned = {"date": planned_date.isoformat(), "status": pd_entry["status"], "price": pd_entry["predicted_price"],
               "lower": pd_entry["lower"], "upper": pd_entry["upper"], "in_window": inside}

    valid = [d for d in entries if d["status"] == VALIDATED]
    highest = None
    for d in valid:
        if highest is None or d["predicted_price"] > highest["predicted_price"]:
            highest = d

    ref = f.get("current_price")
    ref = ref if _valid_price(ref) else None
    last = valid[-1] if valid else None
    change = None
    if ref is not None and last is not None:
        change = {"to_date": last["date"], "pct": round((last["predicted_price"] - ref) / ref * 100, 2),
                  "is_window_end": last["day"] == days}

    comparison = (compare(planned, entries, hold_days) if inside else
                  {"code": "outside_window", "reason": "planned_outside_window", "date": None, "price": None, "diff": None,
                   "diff_pct": None, "wait_days": None})
    experimental = _experimental(entries, planned, inside, hold_days, comparison)
    pol = f.get("policy") or {}
    # why the model's days are (not) shown: the reliability rule's own result for this crop and distance, in the backend's words
    validation = {"mode": pol.get("mode"), "band": pol.get("band"), "reasons": list(pol.get("reasons") or [])[:3],
                  "validated_up_to_days": f.get("last_validated_days"), "method": (f.get("source") or {}).get("method"),
                  "source_kind": (f.get("source") or {}).get("kind")}
    return {"days": days, "hold_days": hold_days, "validation": validation, "experimental": experimental, "start_date": start.isoformat(), "end_date": end.isoformat(), "reference_price": ref,
            "reference_date": f.get("forecast_origin_date"), "entries": entries, "planned": planned,
            "highest": ({"date": highest["date"], "price": highest["predicted_price"]} if highest else None),
            "change": change, "comparison": comparison,
            "validated_days": len(valid), "unvalidated_days": sum(d["status"] == NOT_VALIDATED for d in entries),
            "unavailable_days": sum(d["status"] == UNAVAILABLE for d in entries)}
