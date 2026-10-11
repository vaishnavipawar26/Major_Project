"""Serving-time monthly price forecaster: price for a crop in a city in a future month.

Loads the trained XGBoost model once; never trains. The forecast for a target month is

    nominal price = latest observed price x exp(model real log-change) x (1 + r)^(months / 12)

where the model part comes from the XGBoost regressor (seasonality, supply, mean reversion —
explained with SHAP) and the last factor is the explicit inflation assumption.
"""
from __future__ import annotations

import json
import math

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.common import paths
from app.ml.common.reference import add_months, month_label
from app.ml.explainability.monthly_price_explainer import explain_monthly_price
from app.ml.price_prediction.monthly import (BASE_PERIOD, STATE_SERIES, SeriesContext,
                                             series_frame)

HISTORY_MONTHS = 24
PRICE_SCORE_WINDOW = 12


class MonthlyForecastError(Exception):
    """The forecast cannot be produced honestly (e.g. no price history for the crop)."""


def bucket_of(h: int) -> str:
    return "1-3" if h <= 3 else "4-6" if h <= 6 else "7-12" if h <= 12 else "13-24"


class MonthlyPriceForecaster:
    def __init__(self) -> None:
        d = paths.MONTHLY_PRICE_MODEL_DIR
        self.meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        self.model = joblib.load(d / "monthly_price_model.joblib")
        self.explainer = shap.TreeExplainer(self.model)
        self.base_value = float(np.atleast_1d(self.explainer.expected_value)[0])
        self.features: list[str] = self.meta["features"]
        self.inflation: float = self.meta["inflation_annual"]
        self.h_max: int = self.meta["h_max"]
        self.series_codes: dict[str, int] = self.meta["series_codes"]
        self.crop_codes: dict[str, int] = self.meta["crop_codes"]
        self.end = pd.Period(self.meta["data_end"], freq="M")
        self.version = self.meta["version"]
        self.panel = pd.read_csv(paths.MONTHLY_PANEL_PATH)
        self.modelled = {(c["series"], c["crop"]) for c in self.meta["coverage"] if c["modelled"]}
        pc = pd.read_csv(d / "cv_per_crop_metrics.csv")
        self.crop_cv = {r.crop: (float(r.model_MAE), float(r.naive_MAE)) for r in pc.itertuples()}
        self._ctx: dict[tuple[str, str], SeriesContext] = {}

    # ------------------------------------------------------------------ helpers
    def _context(self, series: str, crop: str) -> SeriesContext:
        key = (series, crop)
        if key not in self._ctx:
            frame = series_frame(self.panel, series, crop, self.end)
            state = series_frame(self.panel, STATE_SERIES, crop, self.end)
            self._ctx[key] = SeriesContext(frame, state, self.inflation, self.crop_codes[crop],
                                           self.series_codes[series])
        return self._ctx[key]

    def resolve_series(self, crop: str, city: str | None) -> tuple[str, str | None]:
        if crop not in self.crop_codes:
            raise MonthlyForecastError(f"No price model for '{crop}'.")
        if city and (city, crop) in self.modelled:
            return city, None
        note = (f"{city} does not have enough {crop} mandi reports for a city-level forecast; "
                "the state-wide (all Maharashtra markets) price is used instead." if city else None)
        return STATE_SERIES, note

    def _effective_h(self, h: int) -> int:
        """Beyond the model's horizon the seasonal pattern repeats yearly, so the same calendar
        month within the modelled range is used (inflation still covers the full period)."""
        while h > self.h_max:
            h -= 12
        return h

    def _period_of(self, t: int) -> tuple[int, int]:
        return add_months(BASE_PERIOD.year, BASE_PERIOD.month, t)

    # ------------------------------------------------------------------ forecast
    def forecast_path(self, crop: str, city: str | None, target_year: int, target_month: int,
                      extra_months: int = 0, explain: bool = True) -> dict:
        """Monthly path from the last observed month up to the target (plus ``extra_months``
        after it, used for the timeline / best-month search), with the target explained."""
        series, note = self.resolve_series(crop, city)
        ctx = self._context(series, crop)
        t0 = ctx.last_observed()
        if t0 is None:
            raise MonthlyForecastError(f"No {crop} price history is available.")
        oy, om = self._period_of(t0)
        h_target = (target_year * 12 + target_month - 1) - (oy * 12 + om - 1)
        if h_target < 1:
            raise MonthlyForecastError(
                f"The selling month must be after the latest price data ({month_label(oy, om)}).")

        horizons = list(range(1, h_target + extra_months + 1))
        eff = [self._effective_h(h) for h in horizons]
        X = ctx.rows(t0, eff)
        pred = self.model.predict(X)
        p0_nominal = float(ctx.frame["price"].iloc[t0])

        path = []
        for h, he, y in zip(horizons, eff, pred):
            infl = (1 + self.inflation) ** (h / 12)
            iv = self.meta["intervals"][bucket_of(he)]
            py, pm = add_months(oy, om, h)
            base = p0_nominal * infl   # latest price carried forward with inflation only
            path.append({"month": month_label(py, pm), "horizon": h, "effective_horizon": he,
                         "price": round(base * math.exp(y), 2),
                         "low": round(base * math.exp(y + iv["q10"]), 2),
                         "high": round(base * math.exp(y + iv["q90"]), 2),
                         "real_log_change": float(y)})

        target = path[h_target - 1]
        window = path[max(0, h_target - 1 - PRICE_SCORE_WINDOW // 2):
                      max(0, h_target - 1 - PRICE_SCORE_WINDOW // 2) + PRICE_SCORE_WINDOW]
        price_score = 100.0 * np.mean([p["price"] <= target["price"] for p in window])
        model_mae, naive_mae = self.crop_cv.get(crop, (math.nan, math.nan))

        hist_start = max(0, t0 - HISTORY_MONTHS + 1)
        history = [{"month": month_label(*self._period_of(t)), "price": round(float(p), 2)}
                   for t, p in zip(range(hist_start, t0 + 1),
                                   ctx.frame["price"].iloc[hist_start:t0 + 1])
                   if not np.isnan(p)]
        change = (target["price"] / p0_nominal - 1) * 100

        out = {
            "crop": crop, "city": city, "series": series, "series_note": note,
            "latest_month": month_label(oy, om), "latest_price": round(p0_nominal, 2),
            "target_month": target["month"], "horizon_months": h_target,
            "beyond_model_horizon": h_target > self.h_max,
            "predicted_price": target["price"], "price_low": target["low"],
            "price_high": target["high"], "change_pct": round(change, 1),
            "trend": "Rising" if change > 5 else "Falling" if change < -5 else "Stable",
            "inflation_annual_pct": round(self.inflation * 100, 2),
            "inflation_effect_pct": round(((1 + self.inflation) ** (h_target / 12) - 1) * 100, 1),
            "price_score": round(float(price_score), 1),
            "history": history, "path": path,
            "reliability": {"model_mae": round(model_mae, 1), "naive_mae": round(naive_mae, 1),
                            "beats_baseline": bool(model_mae < naive_mae)},
        }
        out["peak"] = max(path[:h_target], key=lambda p: p["price"])
        out["trough"] = min(path[:h_target], key=lambda p: p["price"])
        if explain:
            x = X.iloc[[h_target - 1]]
            sv = np.asarray(self.explainer.shap_values(x))[0]
            price_prof, supply_prof = ctx.profiles(t0)
            out["explanation"] = explain_monthly_price(
                crop=crop, shap_values=dict(zip(self.features, map(float, sv))),
                base_value=self.base_value, row=x.iloc[0].to_dict(),
                price_profile=price_prof, supply_profile=supply_prof,
                target_month=target_month, target_label=target["month"],
                latest_label=out["latest_month"], latest_price=p0_nominal,
                predicted_price=target["price"], inflation_effect_pct=out["inflation_effect_pct"],
                city=city if series != STATE_SERIES else None,
                beats_baseline=out["reliability"]["beats_baseline"])
        return out
