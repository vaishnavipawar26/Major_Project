"""Freshness rules: which price a forecast may start from, given how old the records are.

Config flag ``PRICE_FRESHNESS_GATE`` (backend/.env or environment), default ``auto``:
  off   never apply the gate (the year-ago fallback is used whenever the start date is after the records)
  auto  apply the gate automatically once the dataset is fresh, i.e. its last record is at most
        FRESH_DATASET_DAYS before the forecast start date; with older data nothing changes
  on    always apply the gate (with stale data every request would answer "no recent data")

When the gate is applied:
  * the forecast starts from the latest real price of the market (no "same date last year x inflation" projection);
  * a market whose latest price is older than MARKET_MAX_AGE_DAYS uses the latest state-median price instead
    (and the answer says so);
  * a market whose latest price is older than NO_RECENT_DATA_DAYS gets no forecast ("no recent data for this market").
"""
from __future__ import annotations

import os
from datetime import date

FRESH_DATASET_DAYS = 60
MARKET_MAX_AGE_DAYS = 14
NO_RECENT_DATA_DAYS = 60
MODES = ("off", "auto", "on")


def gate_mode() -> str:
    try:
        from app.config.settings import get_settings
        mode = str(get_settings().PRICE_FRESHNESS_GATE).strip().lower()
    except Exception:  # settings need database / JWT variables; fall back to the plain environment variable
        mode = os.getenv("PRICE_FRESHNESS_GATE", "auto").strip().lower()
    return mode if mode in MODES else "auto"


def dataset_is_fresh(as_of: date, data_end: date, days: int = FRESH_DATASET_DAYS) -> bool:
    """True when the records end no more than ``days`` before the start date (or later)."""
    return (as_of - data_end).days <= days


def gate_active(mode: str, as_of: date, data_end: date) -> bool:
    if mode == "on":
        return True
    if mode == "off":
        return False
    return dataset_is_fresh(as_of, data_end)


def market_decision(age_days: int) -> str:
    """'use_market', 'use_state_median' or 'no_recent_data' for a market whose latest price is ``age_days`` old."""
    if age_days > NO_RECENT_DATA_DAYS:
        return "no_recent_data"
    if age_days > MARKET_MAX_AGE_DAYS:
        return "use_state_median"
    return "use_market"
