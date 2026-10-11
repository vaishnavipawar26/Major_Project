"""'Best time to sell' advice from the daily forecast path.

Rules (all prices are model forecasts in Rs/quintal made on the same forecast date):

* Only dates where the model beat the naive "price stays the same" forecast in validation for
  this crop (``beats_baseline``) are compared. Today's price counts as a known option.
* Later dates are only considered up to ``max_hold_days`` after the farmer's date, a
  conservative storage limit for the crop (general guidance, see STORAGE).
* A different date is recommended only when its predicted price differs from the selected
  date's by more than the model's typical error at the longer of the two horizons (median
  absolute out-of-fold error). Smaller differences cannot be told apart from model error, so
  the farmer is told to sell around the selected date and compare current mandi prices.
"""
from __future__ import annotations

import math

DECISION_AID = ("This is a forecast-based decision aid, not a guarantee that prices will rise "
                "or of any profit. Actual mandi prices may differ.")

# General post-harvest guidance (not learned from the data). max_hold_days caps how long
# after the farmer's date a later sale is considered.
STORAGE = {
    "Tomato": {"category": "Highly perishable", "max_hold_days": 7,
               "note": "Ripe tomatoes usually keep only a few days to about a week at room "
                       "temperature; keeping them longer needs cold storage."},
    "Brinjal": {"category": "Highly perishable", "max_hold_days": 7,
                "note": "Brinjal usually stays fresh for only a few days to about a week "
                        "without cold storage."},
    "Cauliflower": {"category": "Highly perishable", "max_hold_days": 7,
                    "note": "Cauliflower loses quality within a few days to a week unless it "
                            "is kept cool."},
    "Cabbage": {"category": "Perishable", "max_hold_days": 14,
                "note": "Firm cabbage heads can usually keep for one to two weeks in a cool, "
                        "shaded and airy place."},
    "Onion": {"category": "Storable with care", "max_hold_days": 60,
              "note": "Well-dried (cured) rabi onion can keep for months in a ventilated store "
                      "(onion chawl), but it still loses weight and some bulbs may rot or "
                      "sprout. Kharif onion does not store well."},
    "Potato": {"category": "Storable with care", "max_hold_days": 60,
               "note": "Potato keeps for months in cold storage, but usually only a few weeks "
                       "in a cool, dark and airy place on the farm."},
    "Wheat": {"category": "Storable", "max_hold_days": 60,
              "note": "Clean, well-dried wheat can be stored for months in sealed bags or bins "
                      "if it is protected from moisture and pests."},
}
DEFAULT_STORAGE = {"category": "Unknown", "max_hold_days": 7,
                   "note": "Check how long this crop can be stored safely before waiting."}

CONSIDERATIONS = [
    "Can you store the crop safely until that date without losing quality?",
    "Storage costs, weight loss and quality loss while you wait.",
    "Transport, commission and other selling costs.",
    "Forecast uncertainty: the real price can fall anywhere in the likely range, or outside it.",
    "Today's prices at your local mandi.",
]


def _fmt_date(iso: str) -> str:
    y, m, d = map(int, iso.split("-"))
    months = ["January", "February", "March", "April", "May", "June", "July", "August",
              "September", "October", "November", "December"]
    return f"{d} {months[m - 1]} {y}"


def _rs(v: float) -> str:
    return f"₹{v:,.0f}"


def best_time_to_sell(path: list[dict], today: dict, target_h: int, commodity: str,
                      projected: bool) -> dict:
    """``path``: daily forecast points (with private ``_band``, the median absolute CV error
    in log units at that horizon); ``today``: the known starting price as a point with
    horizon 0."""
    by_h = {p["horizon_days"]: p for p in path}
    t = by_h[target_h]
    storage = STORAGE.get(commodity, DEFAULT_STORAGE)
    max_hold = storage["max_hold_days"]

    def gain(p: dict) -> float:
        return math.log(p["predicted_price"] / t["predicted_price"])

    def threshold(p: dict) -> float:  # typical error at the longer of the two horizons
        return max(p["_band"], t["_band"]) if p["horizon_days"] else t["_band"]

    later = [p for p in path if target_h < p["horizon_days"] <= target_h + max_hold
             and p["beats_baseline"]]
    earlier = [today] + [p for p in path if p["horizon_days"] < target_h and p["beats_baseline"]]
    best_later = max(later, key=lambda p: p["predicted_price"], default=None)
    best_earlier = max(earlier, key=lambda p: p["predicted_price"])
    falls_after = any(gain(p) < -threshold(p) for p in later)
    target_err_pct = (math.exp(t["_band"]) - 1) * 100

    if not t["beats_baseline"]:
        code, label, rec = ("UNCERTAIN", "Forecast too uncertain to pick an exact date", t)
        why = (f"For {commodity}, when forecasting {target_h} days ahead the model was not more "
               "accurate in testing than simply assuming today's price stays the same. Use the "
               f"predicted price for {_fmt_date(t['date'])} only as a rough guide and compare "
               "current mandi prices before deciding.")
    elif best_later and gain(best_later) > threshold(best_later):
        code, label, rec = "WAIT", "Consider waiting for a better price", best_later
        w = best_later["horizon_days"] - target_h
        why = (f"Your selected date is {_fmt_date(t['date'])}. The model predicts a potentially "
               f"higher price around {_fmt_date(rec['date'])}. Waiting {w} more day"
               f"{'s' if w != 1 else ''} could increase the expected price by about "
               f"{_rs(rec['predicted_price'] - t['predicted_price'])} per quintal "
               f"({gain(rec) * 100:+.1f}%), based on this forecast. This is larger than the "
               "model's usual error, but it only helps if the crop can be stored safely and "
               "your storage and selling costs are lower than this gain.")
    elif gain(best_earlier) > threshold(best_earlier):
        rec = best_earlier
        sell_today = rec["horizon_days"] == 0
        code = "SELL_EARLIER"
        label = "Consider selling now" if sell_today else "Consider selling earlier"
        when = "today's price" if sell_today else f"the price around {_fmt_date(rec['date'])}"
        why = (f"The model expects prices to be lower by your selected date "
               f"({_fmt_date(t['date'])}): {when} is about "
               f"{_rs(rec['predicted_price'] - t['predicted_price'])} per quintal higher "
               f"({gain(rec) * 100:+.1f}%). This drop is larger than the model's usual error, "
               "so selling earlier may be the safer choice.")
    else:
        rec = t
        candidates = [p for p in later + earlier if p is not t]
        top = max(candidates, key=lambda p: p["predicted_price"], default=None)
        if top is None or top["predicted_price"] <= t["predicted_price"]:
            code, label = "SELL_ON_TARGET", "Your selected date looks like a good time to sell"
            why = (f"No earlier date, and no later date up to {max_hold} days after "
                   f"{_fmt_date(t['date'])} (a safe storage time for {commodity}), is predicted "
                   "to give a higher price.")
        else:
            code, label = "NO_CLEAR_DIFFERENCE", "Sell around your selected date"
            diff = top["predicted_price"] - t["predicted_price"]
            err = (math.exp(threshold(top)) - 1) * 100
            why = (f"The best other date, {_fmt_date(top['date'])}, is predicted only about "
                   f"{_rs(diff)} per quintal ({gain(top) * 100:+.1f}%) higher. That is smaller "
                   f"than the model's usual error that far ahead (about ±{err:.0f}%), so it is "
                   "not a dependable reason to change your plan. Compare current mandi prices "
                   "before deciding.")
        if falls_after:
            why += (" Prices are expected to fall after your selected date, so avoid delaying "
                    "the sale.")
    if projected:
        why += (" Mandi data in this app ends before today, so this forecast is a seasonal "
                "projection; check current mandi prices.")

    peak_pool = [p for p in path if p["beats_baseline"]] or path
    peak = max(peak_pool, key=lambda p: p["predicted_price"])
    extra = rec["predicted_price"] - t["predicted_price"]
    return {
        "code": code, "label": label,
        "recommended_date": rec["date"],
        "recommended_horizon_days": rec["horizon_days"],
        "recommended_price": rec["predicted_price"],
        "recommended_low": rec["lower"], "recommended_high": rec["upper"],
        "target_date": t["date"], "target_price": t["predicted_price"],
        "target_low": t["lower"], "target_high": t["upper"],
        "extra_per_quintal": round(extra, 2),
        "extra_pct": round(extra / t["predicted_price"] * 100, 2),
        "wait_days": rec["horizon_days"] - target_h,
        "typical_error_pct": round(target_err_pct, 1),
        "explanation": why,
        "falls_after_target": falls_after,
        "peak": {"date": peak["date"], "horizon_days": peak["horizon_days"],
                 "price": peak["predicted_price"], "reliable": peak["beats_baseline"],
                 "diff_vs_target": round(peak["predicted_price"] - t["predicted_price"], 2),
                 "diff_pct": round((peak["predicted_price"] / t["predicted_price"] - 1) * 100, 2)},
        "storage": {"crop": commodity, **storage},
        "considerations": CONSIDERATIONS,
        "disclaimer": DECISION_AID,
    }
