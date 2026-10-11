"""Indian cropping-season conventions.

Month -> season follows the standard Indian convention used by the Ministry of
Agriculture & Farmers Welfare (DES) when reporting Kharif/Rabi statistics and in
ICAR crop-production material:

* Kharif: sown with the south-west monsoon, June - September
* Rabi:   sown after the monsoon, October - January
* Zaid:   short summer season between Rabi harvest and Kharif sowing, February - May

These are calendar windows only; the crop -> season mapping lives in
dataset/crop_recommendation/crop_season_calendar.csv together with its sources.
"""

KHARIF, RABI, ZAID, YEAR_ROUND = "Kharif", "Rabi", "Zaid", "Year-round"
SEASONS = (KHARIF, RABI, ZAID)

_MONTH_TO_SEASON = {
    6: KHARIF, 7: KHARIF, 8: KHARIF, 9: KHARIF,
    10: RABI, 11: RABI, 12: RABI, 1: RABI,
    2: ZAID, 3: ZAID, 4: ZAID, 5: ZAID,
}

SEASON_CODE = {KHARIF: 0, RABI: 1, ZAID: 2}


def season_for_month(month: int) -> str:
    if month not in _MONTH_TO_SEASON:
        raise ValueError(f"month must be 1-12, got {month}")
    return _MONTH_TO_SEASON[month]
