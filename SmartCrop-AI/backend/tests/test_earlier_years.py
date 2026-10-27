from datetime import date
from types import SimpleNamespace

import pandas as pd

from app.ml.price_prediction.forecaster import PriceForecaster


def _series(prices_by_year):
    rows = []
    for year, p in prices_by_year.items():
        for d in pd.date_range(f"{year}-11-01", f"{year}-11-30"):
            rows.append({"Date": d, "price": p, "observed": True})
    return pd.DataFrame(rows)


def _run(series, target=date(2026, 11, 12), inflation=0.05):
    return PriceForecaster._earlier_years(SimpleNamespace(inflation=inflation), series, target)


def test_price_around_the_target_date_in_each_earlier_year_is_inflation_adjusted():
    out = _run(_series({2025: 2000.0, 2024: 1900.0}))
    assert [o["year"] for o in out] == [2025, 2024]
    assert out[0]["raw_price"] == 2000.0 and out[0]["price"] == 2100.0          # one year of 5 %
    assert out[1]["price"] == round(1900 * 1.05 ** 2, 2)
    assert out[0]["date"] == "2025-11-12" and out[0]["n"] == 15


def test_a_year_with_too_few_reports_is_left_out():
    s = _series({2025: 2000.0})
    s = s[s["Date"].isin(pd.to_datetime(["2025-11-10", "2025-11-12"]))]          # two reports near 12 Nov
    assert _run(s) == []


def test_no_history_gives_an_empty_list():
    assert _run(pd.DataFrame({"Date": pd.to_datetime([]), "price": [], "observed": []})) == []


def _ref_series():
    d = pd.date_range("2025-10-01", "2025-11-30")
    return pd.DataFrame({"Date": d, "price": [2000.0 + i for i in range(len(d))], "observed": [x.day != 20 for x in d]})


def test_reference_after_returns_last_years_prices_moved_to_the_requested_year():
    ctx = SimpleNamespace(years_ahead=1, level=1.05)
    out = PriceForecaster._reference_after(_ref_series(), ctx, date(2025, 10, 16), 10, True)
    assert out[0]["date"] == "2026-10-17" and out[0]["price"] == round(2016.0 * 1.05, 2)
    assert out[-1]["date"] == "2026-10-29"                    # origin + 10 days + 3 days of neighbours
    assert "2026-10-20" not in [o["date"] for o in out]       # a day without a report is not invented


def test_reference_after_is_empty_for_a_real_date():
    assert PriceForecaster._reference_after(_ref_series(), SimpleNamespace(years_ahead=0, level=1.0), date(2025, 10, 16), 10, False) == []


def test_earlier_years_carry_weekly_points_around_the_target_date():
    out = _run(_series({2025: 2000.0}))
    w = out[0]["weekly"]
    assert w["0"] == 2100.0 and w["7"] == 2100.0 and w["-7"] == 2100.0     # flat prices, one year of 5 % inflation
    assert "70" not in w and "-70" not in w and len(w) <= 19
