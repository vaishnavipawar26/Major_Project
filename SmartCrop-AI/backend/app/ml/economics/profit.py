"""Profitability engine: expected revenue, cost and net profit for a crop at a selling month.

Per acre, with the crop's reference figures from dataset/crop_recommendation/crop_economics.csv
(approximate assumptions, see DATASET.md):

    effective yield = yield x (1 - post-harvest loss) x (1 - storage loss/month x months stored)
    gross revenue   = effective yield x forecast mandi price (Rs/quintal)
    marketing cost  = gross revenue x marketing % (commission, transport, hamali)
    cultivation     = cost/acre x (1 + inflation)^(planting year - reference year)
    storage cost    = yield x storage cost/quintal/month x months stored
    net profit      = gross revenue - marketing - cultivation - storage
    ROI             = net profit / (cultivation + storage)

Timing: the crop is ready growth_months_min..growth_months_max after planting. Selling earlier
is impossible ("not ready"); selling later is only possible for storable crops, up to
max_storage_months ("stored"); beyond that perishable produce would spoil.
"""
from __future__ import annotations

import math

from app.ml.common.reference import CropCalendar, CropEconomics, add_months, month_label

FRESH, STORED, NOT_READY, SPOILED = "fresh", "stored", "not_ready", "spoiled"


def timing_status(cal: CropCalendar, offset: int) -> tuple[str, int]:
    """(status, months stored) for selling ``offset`` months after planting."""
    if offset < cal.growth_months_min:
        return NOT_READY, 0
    if offset <= cal.growth_months_max:
        return FRESH, 0
    stored = offset - cal.growth_months_max
    return (STORED, stored) if stored <= cal.max_storage_months else (SPOILED, stored)


def planting_fit(cal: CropCalendar, month: int) -> float:
    if month in cal.planting_months:
        return 100.0
    near = any(min((month - m) % 12, (m - month) % 12) == 1 for m in cal.planting_months)
    return 50.0 if near else 0.0


def timing_score(cal: CropCalendar, planting_month: int, offset: int) -> tuple[float, str, int]:
    status, stored = timing_status(cal, offset)
    sell = {FRESH: 100.0, STORED: max(0.0, 100.0 - 12.0 * stored)}.get(status, 0.0)
    return 0.5 * planting_fit(cal, planting_month) + 0.5 * sell, status, stored


def economic_score(roi: float) -> float:
    """0-100: 50 = break-even, ~88 = ROI 100 %, ~12 = ROI -100 %."""
    return round(50 + 50 * math.tanh(roi), 1)


def evaluate(crop_econ: CropEconomics, cal: CropCalendar, *, price: float, price_low: float,
             price_high: float, offset: int, planting_year: int, area_acres: float,
             inflation: float) -> dict:
    status, stored = timing_status(cal, offset)
    e = crop_econ
    keep = (1 - e.post_harvest_loss_pct / 100) * max(0.0, 1 - e.storage_loss_pct_per_month / 100 * stored)
    eff_yield = e.yield_q_per_acre * keep * area_acres
    cultivation = e.cost_per_acre_inr * (1 + inflation) ** max(0, planting_year - e.cost_reference_year) * area_acres
    storage = e.yield_q_per_acre * e.storage_cost_per_q_month * stored * area_acres
    mkt = e.marketing_cost_pct / 100

    def net(p: float) -> float:
        return eff_yield * p * (1 - mkt) - cultivation - storage

    revenue = eff_yield * price
    total_cost = cultivation + storage
    profit = net(price)
    # ROI uses the same all-in costs that are shown to the farmer (cultivation + storage + marketing), so
    # net profit / total_cost x 100 reproduces the displayed ROI exactly.
    all_in_cost = total_cost + revenue * mkt
    roi = profit / all_in_cost if all_in_cost else 0.0
    break_even = total_cost / (eff_yield * (1 - mkt)) if eff_yield else None
    return {
        "area_acres": area_acres, "status": status, "months_stored": stored,
        "feasible": status in (FRESH, STORED),
        "selling_price": round(price, 2), "price_low": round(price_low, 2),
        "price_high": round(price_high, 2),
        "yield_q_per_acre": e.yield_q_per_acre, "effective_yield_q": round(eff_yield, 1),
        "gross_revenue": round(revenue, 0), "marketing_cost": round(revenue * mkt, 0),
        "cultivation_cost": round(cultivation, 0), "storage_cost": round(storage, 0),
        "total_cost": round(total_cost + revenue * mkt, 0),
        "net_profit": round(profit, 0),
        "net_profit_low": round(net(price_low), 0), "net_profit_high": round(net(price_high), 0),
        "roi_pct": round(roi * 100, 1),
        "break_even_price": None if break_even is None else round(break_even, 0),
        "profit_score": economic_score(roi) if status in (FRESH, STORED) else 0.0,
    }


def timeline(cal: CropCalendar, planting_year: int, planting_month: int, selling_offset: int,
             best_offset: int | None, best_profit: float | None) -> dict:
    def label(k: int) -> str:
        return month_label(*add_months(planting_year, planting_month, k))
    status, stored = timing_status(cal, selling_offset)
    return {
        "planting": label(0),
        "harvest_start": label(cal.growth_months_min),
        "harvest_end": label(cal.growth_months_max),
        "storage_until": label(cal.growth_months_max + cal.max_storage_months)
        if cal.max_storage_months else None,
        "selling": label(selling_offset), "selling_offset": selling_offset,
        "growth_months_min": cal.growth_months_min, "growth_months_max": cal.growth_months_max,
        "max_storage_months": cal.max_storage_months, "storable": cal.storable,
        "status": status, "months_stored": stored,
        "optimal_selling": None if best_offset is None else label(best_offset),
        "optimal_offset": best_offset, "optimal_net_profit": best_profit,
        "planting_months": list(cal.planting_months),
        "planting_in_window": planting_month in cal.planting_months,
    }
