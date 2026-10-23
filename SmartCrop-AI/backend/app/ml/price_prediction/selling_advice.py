"""Smart selling recommendation from the daily forecast path.

The farmer's selected date is their *planned* date, not automatically the best one. Rules (all
prices are model forecasts in Rs/quintal made on the same forecast date):

* Only dates with a usable predicted price where the model beat the naive "price stays the
  same" forecast in validation for this crop (``beats_baseline``) are compared.
* Only the planned date or a later date is ever recommended. A higher price before the planned
  date is reported (``best_before``) but not recommended, since the farmer planned to sell later.
* Later dates are recommended only up to ``max_hold_days`` after the planned date, a
  conservative storage limit for the crop with good storage (general guidance, see STORAGE).
  ``farm_hold_days`` is the shorter limit for ordinary farm storage: waiting longer than that
  is flagged as needing proper (e.g. cold) storage, and the best date within it is also given.
  A higher price predicted only after ``max_hold_days`` is reported (STORAGE_LIMIT) but never
  recommended.
* A later date is recommended only when its predicted price is higher than the planned date's
  by more than the model's typical error at the longer of the two horizons (median absolute
  out-of-fold error). Smaller differences cannot be told apart from model error
  (NO_CLEAR_DIFFERENCE).
* If the planned date has no usable or validated prediction, no comparison is made
  (UNAVAILABLE).

Cases: WAIT (better future date), STORAGE_LIMIT (higher price only after safe storage time),
NO_CLEAR_DIFFERENCE (higher price within model error), SELL_ON_TARGET (planned date is the best
practical option; ``best_before`` tells whether an earlier date was higher), UNAVAILABLE.
"""
from __future__ import annotations

import math

DECISION_AID = ("This is a forecast-based decision aid, not a guarantee that prices will rise "
                "or of any profit. Actual mandi prices may differ.")

# General post-harvest guidance (not learned from the data). max_hold_days caps how long
# after the farmer's date a later sale is considered (with good storage); farm_hold_days is
# the shorter time the crop usually keeps in ordinary farm conditions (equal to max_hold_days
# unless the note says ordinary farm storage is shorter).
STORAGE = {
    "Tomato": {"category": "Highly perishable", "max_hold_days": 7, "farm_hold_days": 7,
               "note": "Ripe tomatoes usually keep only a few days to about a week at room "
                       "temperature; keeping them longer needs cold storage."},
    "Brinjal": {"category": "Highly perishable", "max_hold_days": 7, "farm_hold_days": 7,
                "note": "Brinjal usually stays fresh for only a few days to about a week "
                        "without cold storage."},
    "Cauliflower": {"category": "Highly perishable", "max_hold_days": 7, "farm_hold_days": 7,
                    "note": "Cauliflower loses quality within a few days to a week unless it "
                            "is kept cool."},
    "Cabbage": {"category": "Perishable", "max_hold_days": 14, "farm_hold_days": 14,
                "note": "Firm cabbage heads can usually keep for one to two weeks in a cool, "
                        "shaded and airy place."},
    "Onion": {"category": "Storable with care", "max_hold_days": 60, "farm_hold_days": 60,
              "note": "Well-dried (cured) rabi onion can keep for months in a ventilated store "
                      "(onion chawl), but it still loses weight and some bulbs may rot or "
                      "sprout. Kharif onion does not store well."},
    "Potato": {"category": "Storable with care", "max_hold_days": 60, "farm_hold_days": 21,
               "note": "Potato keeps for months in cold storage, but usually only a few weeks "
                       "in a cool, dark and airy place on the farm."},
    "Wheat": {"category": "Storable", "max_hold_days": 60, "farm_hold_days": 60,
              "note": "Clean, well-dried wheat can be stored for months in sealed bags or bins "
                      "if it is protected from moisture and pests."},
}
DEFAULT_STORAGE = {"category": "Unknown", "max_hold_days": 7, "farm_hold_days": 7,
                   "note": "Check how long this crop can be stored safely before waiting."}

CONSIDERATIONS = [
    "Can you store the crop safely until that date without losing quality?",
    "Storage costs, weight loss and quality loss while you wait.",
    "Transport, commission and other selling costs.",
    "Forecast uncertainty: the real price can fall anywhere in the likely range, or outside it.",
    "Today's prices at your local mandi.",
]

LABELS = {
    "WAIT": "A better selling date may be available",
    "NO_CLEAR_DIFFERENCE": "No clear advantage from waiting",
    "SELL_ON_TARGET": "Sell on your planned date",
    "STORAGE_LIMIT": "Storage conditions may limit waiting",
    "UNAVAILABLE": "Reliable comparison unavailable",
}


def _fmt_date(iso: str) -> str:
    y, m, d = map(int, iso.split("-"))
    months = ["January", "February", "March", "April", "May", "June", "July", "August",
              "September", "October", "November", "December"]
    return f"{d} {months[m - 1]} {y}"


def _rs(v: float) -> str:
    return f"₹{v:,.0f}"


def _days(n: int) -> str:
    return f"{n} day{'s' if abs(n) != 1 else ''}"


def _valid(p: dict | None) -> bool:
    v = p.get("predicted_price") if p else None
    return (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
            and v > 0)


def _top(points: list[dict]) -> dict | None:
    return max(points, key=lambda p: p["predicted_price"], default=None)


def reliable_peak(path: list[dict]) -> dict | None:
    """Highest usable predicted price among validated dates: the single 'highest price' that
    the chart summary and the recommendation both refer to."""
    return _top([p for p in path if p.get("beats_baseline") and _valid(p)])


def _peak_info(peak: dict | None, t: dict | None) -> dict | None:
    if peak is None:
        return None
    base = t["predicted_price"] if _valid(t) else None
    return {"date": peak["date"], "horizon_days": peak["horizon_days"],
            "price": peak["predicted_price"], "reliable": True,
            "diff_vs_target": None if base is None else round(peak["predicted_price"] - base, 2),
            "diff_pct": None if base is None else round((peak["predicted_price"] / base - 1) * 100, 2)}


def _unavailable(path: list[dict], t: dict | None, target_h: int, storage: dict, commodity: str,
                 why: str, reason: str) -> dict:
    """No reliable comparison: never invent a price or a date."""
    ok = _valid(t)
    price = t["predicted_price"] if ok else None
    return {
        "code": "UNAVAILABLE", "label": LABELS["UNAVAILABLE"],
        "recommended_date": t["date"] if t else None,
        "recommended_horizon_days": target_h, "recommended_price": price,
        "recommended_low": t.get("lower") if ok else None,
        "recommended_high": t.get("upper") if ok else None,
        "target_date": t["date"] if t else None, "target_price": price,
        "target_low": t.get("lower") if ok else None, "target_high": t.get("upper") if ok else None,
        "extra_per_quintal": 0.0 if ok else None, "extra_pct": 0.0 if ok else None,
        "wait_days": 0,
        "typical_error_pct": round((math.exp(t["_band"]) - 1) * 100, 1) if ok and "_band" in t else None,
        "explanation": why, "reason": reason,
        "falls_after_target": False, "needs_special_storage": False,
        "best_before": None, "best_after": None,
        "alternative": None, "beyond_storage": None, "farm_option": None,
        "peak": _peak_info(reliable_peak(path), t),
        "storage": {"crop": commodity, **storage},
        "considerations": CONSIDERATIONS, "disclaimer": DECISION_AID,
    }


def no_direction_advice(path: list[dict], target_h: int, commodity: str) -> dict:
    """Used where the model is not trusted to claim a rise or fall (context-only crops): no model price, no dates compared."""
    storage = STORAGE.get(commodity, DEFAULT_STORAGE)
    t = next((p for p in path if p.get("horizon_days") == target_h), None)
    out = _unavailable(
        path, t, target_h, storage, commodity,
        f"For {commodity}, the model is not used to predict a rise or fall this far ahead, so no selling dates are compared.",
        "In testing, the model was not more accurate than simply assuming the price stays the same. "
        "Check current mandi prices before deciding.")
    for k in ("recommended_price", "recommended_low", "recommended_high", "target_price", "target_low", "target_high",
              "extra_per_quintal", "extra_pct", "typical_error_pct", "peak"):
        out[k] = None
    return out


def best_time_to_sell(path: list[dict], target_h: int, commodity: str, projected: bool) -> dict:
    """``path``: daily forecast points (with private ``_band``, the median absolute CV error
    in log units at that horizon); ``target_h``: days from the forecast date to the planned
    selling date."""
    storage = STORAGE.get(commodity, DEFAULT_STORAGE)
    max_hold, farm_hold = storage["max_hold_days"], storage["farm_hold_days"]
    crop = commodity.lower()
    t = next((p for p in path if p.get("horizon_days") == target_h), None)

    if not _valid(t):
        return _unavailable(
            path, t, target_h, storage, commodity,
            "A reliable selling-date comparison is not available, because the forecast has no "
            "usable price for your planned date.",
            "Check current mandi prices before deciding.")
    t_date = _fmt_date(t["date"])
    if not t["beats_baseline"]:
        return _unavailable(
            path, t, target_h, storage, commodity,
            f"The model's forecast for your planned date ({t_date}, "
            f"{_rs(t['predicted_price'])} per quintal) is only a rough guide, so it cannot be "
            "reliably compared with other dates.",
            f"For {commodity}, when forecasting {_days(target_h)} ahead, the model was not more "
            "accurate in testing than simply assuming today's price stays the same. Check "
            "current mandi prices before deciding.")

    def gain(p: dict) -> float:  # log ratio, compared with the log-scale model error
        return math.log(p["predicted_price"] / t["predicted_price"])

    def threshold(p: dict) -> float:  # typical error at the longer of the two horizons
        return max(p["_band"], t["_band"])

    def err_pct(p: dict) -> float:
        return (math.exp(threshold(p)) - 1) * 100

    def meaningful(p: dict | None) -> bool:
        return p is not None and gain(p) > threshold(p)

    def higher(p: dict | None) -> dict | None:
        return p if p is not None and p["predicted_price"] > t["predicted_price"] else None

    def option(p: dict | None) -> dict | None:
        if p is None:
            return None
        extra = p["predicted_price"] - t["predicted_price"]
        return {"date": p["date"], "horizon_days": p["horizon_days"],
                "price": p["predicted_price"], "extra_per_quintal": round(extra, 2),
                "extra_pct": round(extra / t["predicted_price"] * 100, 2),
                "days_from_target": p["horizon_days"] - target_h,
                "error_pct": round(err_pct(p), 1), "meaningful": meaningful(p)}

    usable = [p for p in path if p is not t and p.get("beats_baseline") and _valid(p)]
    before = [p for p in usable if p["horizon_days"] < target_h]
    after = [p for p in usable if p["horizon_days"] > target_h]
    within = [p for p in after if p["horizon_days"] - target_h <= max_hold]
    beyond = [p for p in after if p["horizon_days"] - target_h > max_hold]

    best_before = higher(_top(before))
    best_after = higher(_top(after))
    best_within = higher(_top(within))  # the best practical future date
    best_beyond = higher(_top(beyond))
    if best_beyond and best_within and best_beyond["predicted_price"] <= best_within["predicted_price"]:
        best_beyond = None
    best_farm = _top([p for p in within if p["horizon_days"] - target_h <= farm_hold])
    falls_after = any(gain(p) < -threshold(p) for p in within)
    peak = reliable_peak(path)
    farm_option = None
    alternative = best_within

    if meaningful(best_within):  # Case A
        code, rec = "WAIT", best_within
        w = rec["horizon_days"] - target_h
        extra = rec["predicted_price"] - t["predicted_price"]
        r_date = _fmt_date(rec["date"])
        why = (f"Waiting until {r_date} may offer a higher predicted price of "
               f"{_rs(rec['predicted_price'])} per quintal, compared with "
               f"{_rs(t['predicted_price'])} on your planned date ({t_date}). This is about "
               f"{_rs(extra)} ({extra / t['predicted_price'] * 100:+.1f}%) more per quintal "
               f"before storage costs and losses, for {_days(w)} of extra waiting. The increase "
               f"is larger than the model's usual error that far ahead (about "
               f"±{err_pct(rec):.0f}%).")
        if w <= farm_hold:
            reason = (f"Consider waiting only if you can store your {crop} safely until {r_date} "
                      "and keep its quality, and if the extra money is more than your storage, "
                      "transport and other costs.")
        else:
            reason = (f"Waiting {_days(w)} is longer than {crop} usually keeps in ordinary farm "
                      f"storage (about {_days(farm_hold)}), so only wait if you have cold storage "
                      "or other proper storage and the extra money covers its cost.")
            if meaningful(best_farm):
                farm_option = best_farm
                reason += (f" Without such storage, the best date within {_days(farm_hold)} is "
                           f"{_fmt_date(best_farm['date'])} at {_rs(best_farm['predicted_price'])} "
                           "per quintal.")
    elif best_beyond:  # Case D
        code, rec = "STORAGE_LIMIT", t
        b = best_beyond
        small = "" if meaningful(b) else (" The difference is also small compared with "
                                          "forecast uncertainty.")
        why = (f"The model predicts a higher price around {_fmt_date(b['date'])} "
               f"({_rs(b['predicted_price'])} per quintal), but that is "
               f"{_days(b['horizon_days'] - target_h)} after your planned date, longer than "
               f"{crop} can usually be stored safely (about {_days(max_hold)}). Selling on "
               f"{t_date} ({_rs(t['predicted_price'])} per quintal) is the practical choice."
               + small)
        reason = (f"Do not hold your {crop} that long just to chase a higher price: keeping the "
                  "crop safe and in good quality matters more, and weight loss, spoilage and "
                  "storage costs could cancel the gain.")
        alternative = None
    elif best_within:  # Case E
        code, rec = "NO_CLEAR_DIFFERENCE", t
        diff = best_within["predicted_price"] - t["predicted_price"]
        why = (f"The model predicts a slightly higher price on {_fmt_date(best_within['date'])} "
               f"({_rs(best_within['predicted_price'])}, about {_rs(diff)} or "
               f"{diff / t['predicted_price'] * 100:+.1f}% more per quintal), but the difference "
               "is small compared with forecast uncertainty (the model's usual error that far "
               f"ahead is about ±{err_pct(best_within):.0f}%). It is not a reliable opportunity.")
        reason = ("Compare current mandi prices and your storage costs before deciding. If you "
                  f"cannot store the {crop} well, selling on your planned date avoids the risk.")
    else:  # Cases B and C
        code, rec = "SELL_ON_TARGET", t
        if best_before:
            where = ("The highest predicted price in the available forecast"
                     if peak is best_before else "The highest predicted price before your planned date")
            why = (f"{where} is on {_fmt_date(best_before['date'])} "
                   f"({_rs(best_before['predicted_price'])} per quintal). No higher suitable price "
                   f"is predicted after your planned date, so selling on {t_date} "
                   f"({_rs(t['predicted_price'])} per quintal) remains a reasonable option.")
        else:
            why = (f"Your planned date ({t_date}, {_rs(t['predicted_price'])} per quintal) has the "
                   "best predicted price among the dates compared. Waiting is not expected to "
                   f"give a higher price within {_days(max_hold)} after it (the safe storage "
                   f"time for {crop}).")
        reason = ("This is based on the current forecast window only, not the whole season. "
                  "Check current mandi prices before you sell; selling on time also avoids "
                  "storage costs, weight loss and quality loss.")
    if falls_after and code in ("SELL_ON_TARGET", "NO_CLEAR_DIFFERENCE"):
        reason += " Prices are expected to fall after your planned date, so avoid delaying the sale."
    if projected:
        reason += (" Mandi data in this app ends before today, so this forecast is a seasonal "
                   "projection; check current mandi prices.")

    extra = rec["predicted_price"] - t["predicted_price"]
    wait = rec["horizon_days"] - target_h
    return {
        "code": code, "label": LABELS[code],
        "recommended_date": rec["date"],
        "recommended_horizon_days": rec["horizon_days"],
        "recommended_price": rec["predicted_price"],
        "recommended_low": rec["lower"], "recommended_high": rec["upper"],
        "target_date": t["date"], "target_price": t["predicted_price"],
        "target_low": t["lower"], "target_high": t["upper"],
        "extra_per_quintal": round(extra, 2),
        "extra_pct": round(extra / t["predicted_price"] * 100, 2),
        "wait_days": wait,
        "typical_error_pct": round((math.exp(t["_band"]) - 1) * 100, 1),
        "explanation": why,
        "reason": reason,
        "falls_after_target": falls_after,
        "needs_special_storage": wait > farm_hold,
        "best_before": option(best_before),
        "best_after": option(best_after),
        "alternative": option(alternative),
        "beyond_storage": option(best_beyond),
        "farm_option": option(farm_option),
        "peak": _peak_info(peak, t),
        "storage": {"crop": commodity, **storage},
        "considerations": CONSIDERATIONS,
        "disclaimer": DECISION_AID,
    }
