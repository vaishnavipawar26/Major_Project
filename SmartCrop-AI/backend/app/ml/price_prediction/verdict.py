"""The single place that decides what a forecast is called, so the result page, the explanation page, the history and
the dashboard cannot disagree.

* ``price_verdict``  - "rise" / "fall" / "about_the_same" from the model estimate, the starting price and the typical miss
                       (mean absolute error of backtests for this crop x distance band).
* ``latest_recorded`` / ``latest_text`` - the ONE "latest recorded price" (the last price the market actually reported, with
                       its real date and age) and the sentence used wherever the model gives no direction.
* ``horizon_info``   - days from today versus the days the model counts from the market's last report.
"""
from __future__ import annotations

from datetime import date

STALE_DAYS = 60            # a recorded price older than this is described in months and "no forecast"
SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(d: date) -> str:
    return f"{d.day} {SHORT[d.month - 1]} {d.year}"


def price_verdict(start_price: float, predicted_price: float, typical_miss: float | None) -> dict:
    """Codes: rise, fall, about_the_same, and no_clear_direction (only when no typical miss exists). Both pages call this with the same rounded numbers. |change| < typical miss means "about the same"."""
    start, est = round(float(start_price), 2), round(float(predicted_price), 2)
    change = round(est - start, 2)
    pct = round(change / start * 100, 2) if start else 0.0
    if typical_miss is None:
        code = "no_clear_direction"          # no backtest figure to compare the change with
    elif abs(change) < typical_miss:
        code = "about_the_same"
    else:
        code = "rise" if change > 0 else "fall"
    return {"code": code, "start_price": start, "model_estimate": est, "change_inr": change, "change_pct": pct,
            "typical_miss_inr": None if typical_miss is None else round(float(typical_miss), 2)}


def latest_recorded(price: float, last_date: date, as_of: date) -> dict:
    """The last price a market reported, aged against the forecast start date ``as_of``."""
    age = max((as_of - last_date).days, 0)
    stale = age > STALE_DAYS
    n, unit = (max(round(age / 30.44), 2), "months") if stale else (age, "days")
    return {"price": round(float(price), 2), "date": last_date.isoformat(), "age_days": age, "stale": stale,
            "age_n": n, "age_unit": unit}


def latest_text(lr: dict) -> str:
    """The sentence shown wherever the model is not used to claim a direction."""
    d = date.fromisoformat(lr["date"])
    if lr["age_unit"] == "months":
        ago = f"{lr['age_n']} months ago"
    else:
        ago = "today" if lr["age_n"] == 0 else f"{lr['age_n']} day{'s' if lr['age_n'] != 1 else ''} ago"
    tail = "No forecast for this crop." if lr["stale"] else "No clear direction for this crop and distance."
    return f"Latest recorded price: ₹{lr['price']:,.0f} ({fmt_date(d)}, {ago}). {tail}"


def horizon_info(days_from_today: int, counted_from: date, covers_days: int) -> dict:
    """``covers_days`` is what the model actually forecasts (from the market's last report), which can exceed the days asked for."""
    return {"days_from_today": days_from_today, "counted_from": counted_from.isoformat(), "covers_days": covers_days,
            "differs": covers_days != days_from_today}
