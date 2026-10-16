"""Serving-time price forecaster. Loads trained artifacts once; never trains.

A forecast is a daily path: one direct model prediction for every day 1 .. MAX_HORIZON after
the forecast origin (see features.py). Each date gets its own prediction from data known at
the origin, so no predicted price is ever fed back in as an input (no recursion).
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import date, timedelta

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.common import paths
from app.ml.explainability.price_explainer import explain_price
from app.ml.price_prediction.features import (FEATURE_COLUMNS, HORIZONS, MAX_HORIZON,
                                              PRICE_FFILL_LIMIT, SERIES_KEY, STATE_MARKET,
                                              STATE_VARIETY, TARGET_FFILL_LIMIT,
                                              compute_features, with_pair_features)
from app.ml.price_prediction.selling_advice import best_time_to_sell

log = logging.getLogger(__name__)

HISTORY_DAYS = 60
PROJECTION_END = date(2027, 12, 31)  # latest date a seasonal projection may start from
DEFAULT_INFLATION = 0.05  # used only if the monthly model's inflation assumption is missing
MIN_RESIDUAL_SAMPLES = 200  # crop-specific error band needs at least this many CV errors
DISCLAIMER = ("This is a model-based estimate and actual market prices may differ. "
              "It is not a guarantee.")


class ForecastError(Exception):
    """Input is valid but a forecast cannot be produced honestly (e.g. too little data)."""


@dataclass
class SeriesRef:
    state: str
    market: str
    commodity: str
    variety: str


class PriceForecaster:
    def __init__(self) -> None:
        d = paths.PRICE_MODEL_DIR
        self.meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        prep = joblib.load(d / "price_preprocessing.joblib")
        self.encoders = prep["encoders"]
        self.feature_columns: list[str] = prep["feature_columns"]
        # each horizon is served by the candidate model that was most accurate there in CV;
        # "rate" models predict the average daily change, so their output is multiplied by h
        self.models = {c: joblib.load(d / f) for c, f in self.meta["model_files"].items()}
        self.rate_form = {c: self.meta["candidates"][c]["target_form"] == "rate"
                          for c in self.models}
        self.horizon_models = {int(h): c for h, c in self.meta["horizon_models"].items()}
        self.explainers = {c: shap.TreeExplainer(m) for c, m in self.models.items()}
        self.max_horizon = int(self.meta["max_horizon"])
        self.panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
        for c in SERIES_KEY:
            self.panel[c] = self.panel[c].astype(str)
        self._series = {k: g.reset_index(drop=True)
                        for k, g in self.panel.groupby(SERIES_KEY, sort=False)}
        self.support = pd.read_csv(paths.CROP_PRICE_DIR / "supported_series.csv")
        # CV errors per crop and horizon, at exactly that horizon (shown to users) and pooled
        # over h +- 3 days. A horizon is validated only if the forecaster beat "no change" on
        # both, so neither noise nor neighbouring horizons can validate it on their own.
        pc = pd.read_csv(d / "cv_per_crop_metrics.csv").dropna(
            subset=["model_MAE", "naive_MAE", "model_MAE_unsmoothed", "naive_MAE_unsmoothed"])
        self.crop_cv = {(int(r.horizon), r.commodity):
                        (float(r.model_MAE_unsmoothed), float(r.naive_MAE_unsmoothed))
                        for r in pc.itertuples()}
        ok = pc[(pc["model_MAE"] < pc["naive_MAE"])
                & (pc["model_MAE_unsmoothed"] < pc["naive_MAE_unsmoothed"])]
        self._validated = {c: sorted(int(h) for h in g["horizon"])
                           for c, g in ok.groupby("commodity")}
        self.data_start = date.fromisoformat(self.meta["data_start"])
        self.data_end = date.fromisoformat(self.meta["data_end"])
        self.version = self.meta["version"]
        self.inflation = _load_inflation()

    # ------------------------------------------------------------------ catalogue
    def options(self) -> dict:
        sup = self.support[self.support["supported"]]
        crops = []
        for commodity, g in sup.groupby("Commodity"):
            markets = []
            for market, mg in g.groupby("Market"):
                markets.append({"market": market,
                                "is_state_aggregate": market == STATE_MARKET,
                                "varieties": sorted(mg["Variety"].tolist()),
                                "default_variety": _default_variety(mg),
                                "first_date": mg["first_date"].min(),
                                "last_date": mg["last_date"].max()})
            markets.sort(key=lambda m: (not m["is_state_aggregate"], m["market"]))
            crops.append({"commodity": commodity, "states": sorted(g["State"].unique().tolist()),
                          "markets": markets,
                          "validated_horizons": self.validated_horizons(commodity)})
        return {"data_start": self.data_start.isoformat(), "data_end": self.data_end.isoformat(),
                "projection_end": PROJECTION_END.isoformat(),
                "inflation_annual_pct": round(self.inflation * 100, 2),
                "max_horizon_days": self.max_horizon, "commodities": crops,
                "unsupported_series": int((~self.support["supported"]).sum())}

    def default_variety(self, state: str, market: str, commodity: str) -> str:
        rows = self.support[(self.support["State"] == state) & (self.support["Market"] == market)
                            & (self.support["Commodity"] == commodity) & self.support["supported"]]
        if rows.empty:
            raise ForecastError(f"No price history exists for {commodity} at {market}.")
        return _default_variety(rows)

    def has_commodity(self, commodity: str) -> bool:
        return commodity.lower() in {c.lower() for c in self.encoders["commodity"]}

    def reliability(self, h: int, commodity: str) -> tuple[float, float]:
        """(model MAE, naive MAE) in CV for this crop and horizon (pooled if unknown)."""
        if (h, commodity) in self.crop_cv:
            return self.crop_cv[(h, commodity)]
        sel = self.meta["selected"]
        return sel["cv_mean"]["all"]["MAE"], sel["naive_cv_mean"]["all"]["MAE"]

    def validated_horizons(self, commodity: str) -> list[int]:
        """Horizons at which the forecaster beat 'no change' for this crop in CV."""
        return self._validated.get(commodity, [])

    def _predict(self, X: pd.DataFrame) -> np.ndarray:
        """Log-change forecast for model rows whose ``horizon_days`` covers 1..max_horizon."""
        h = X["horizon_days"].to_numpy().astype(int)
        out = np.empty(len(X))
        for c, model in self.models.items():
            rows = np.array([self.horizon_models[k] == c for k in h])
            if rows.any():
                p = model.predict(X[rows])
                out[rows] = p * h[rows] if self.rate_form[c] else p
        return out

    # ------------------------------------------------------------------ helpers
    def _get_series(self, ref: SeriesRef) -> pd.DataFrame:
        key = (ref.state, ref.market, ref.commodity, ref.variety)
        s = self._series.get(key)
        if s is None:
            raise ForecastError("No price history exists for this state / market / crop "
                                "combination.")
        row = self.support[(self.support["State"] == ref.state) &
                           (self.support["Market"] == ref.market) &
                           (self.support["Commodity"] == ref.commodity) &
                           (self.support["Variety"] == ref.variety)]
        if row.empty or not bool(row["supported"].iloc[0]):
            raise ForecastError("This market has too little price history for a reliable "
                                "forecast. Try 'All markets (state median)'.")
        return s

    def _interval(self, h: int, commodity: str) -> dict:
        iv = self.meta["residual_intervals"][str(h)]
        c = iv.get(commodity)
        return c if c and c.get("n", 0) >= MIN_RESIDUAL_SAMPLES else iv["_all"]

    def _reference_date(self, as_of: date) -> tuple[date, int]:
        """Date inside the dataset to take features from, and how many years it was shifted.

        Dates after ``data_end`` have no observed prices, so the same calendar day in the
        latest dataset year is used instead: its lags, rolling means, arrivals and seasonal
        features describe the same point in the crop's yearly cycle."""
        years = 0
        ref = as_of
        while ref > self.data_end:
            years += 1
            ref = _shift_years(as_of, -years)
        return ref, years

    # ------------------------------------------------------------------ forecast
    def forecast(self, ref: SeriesRef, as_of: date, target_date: date,
                 explain: bool = True) -> dict:
        if as_of < self.data_start or as_of > PROJECTION_END:
            raise ForecastError(f"The forecast date must be between {self.data_start} and "
                                f"{PROJECTION_END}. Prices are observed up to {self.data_end}; "
                                "later dates are seasonal projections.")
        input_date = as_of
        as_of, years_ahead = self._reference_date(as_of)
        projected = years_ahead > 0
        # price level carried from the reference year to the requested year (inflation only)
        level = (1 + self.inflation) ** years_ahead
        series = self._get_series(ref)
        feats = compute_features(series, self.encoders, with_targets=False)

        as_of_ts = pd.Timestamp(as_of)
        window = feats[(feats["Date"] <= as_of_ts) &
                       (feats["Date"] > as_of_ts - pd.Timedelta(days=PRICE_FFILL_LIMIT)) &
                       feats["observed"]]
        if window.empty:
            raise ForecastError(f"This market did not report a {ref.commodity} price in the "
                                f"{PRICE_FFILL_LIMIT} days up to {as_of}, so there is no recent "
                                "price to forecast from. Choose 'All markets (state median)' "
                                "or another market.")
        origin = window.iloc[-1]
        missing = [c for c in FEATURE_COLUMNS if pd.isna(origin[c])]
        if missing:
            what = ("market arrivals" if any("arrivals" in c for c in missing)
                    else "continuous price history (about 30 days of reports)")
            raise ForecastError(f"This market does not have enough recent {what} for a "
                                "reliable forecast. Choose 'All markets (state median)' or "
                                "another market.")

        ref_p0 = float(origin["price"])
        p0 = ref_p0 * level
        ref_origin_date = origin["Date"].date()
        origin_date = _shift_years(ref_origin_date, years_ahead)
        target_h = (target_date - origin_date).days
        if target_h < 1:
            raise ForecastError("Choose a target date after the forecast date.")
        if target_h > self.max_horizon:
            raise ForecastError(f"The model forecasts at most {self.max_horizon} days after the "
                                f"last reported price ({origin_date}). Choose a target date on "
                                f"or before {origin_date + timedelta(days=self.max_horizon)}.")

        # one model row per horizon; every row uses only data known at the origin
        origins = pd.DataFrame([origin] * len(HORIZONS))
        X = with_pair_features(origins, np.asarray(HORIZONS))[self.feature_columns]
        preds = self._predict(X)

        tp = series.set_index("Date")["price"].ffill(limit=TARGET_FFILL_LIMIT)
        validated = set(self.validated_horizons(ref.commodity))
        path = []
        for h, pred in zip(HORIZONS, map(float, preds)):
            iv = self._interval(h, ref.commodity)
            band = iv["median_abs"]
            model_mae, base_mae = self.reliability(h, ref.commodity)
            d = origin_date + timedelta(days=h)
            actual = None if projected else tp.get(pd.Timestamp(d))
            path.append({
                "horizon_days": h, "date": d.isoformat(),
                "predicted_price": round(p0 * math.exp(pred), 2),
                "lower": round(p0 * math.exp(pred + iv["q10"]), 2),
                "upper": round(p0 * math.exp(pred + iv["q90"]), 2),
                "change_pct": round((math.exp(pred) - 1) * 100, 2),
                "stable_band_pct": round((math.exp(band) - 1) * 100, 2),
                "direction": "Stable" if abs(pred) < band else
                             ("Increasing" if pred > 0 else "Decreasing"),
                "actual_price": None if actual is None or pd.isna(actual) else round(float(actual), 2),
                "beats_baseline": h in validated,
                "model_mae": round(model_mae, 1), "baseline_mae": round(base_mae, 1),
                "_band": band,
            })

        # show dates up to the target and, beyond it, up to the last validated date
        last_validated = max(validated, default=0)
        shown = path[:max(target_h, last_validated)]
        advice = best_time_to_sell(shown, target_h, ref.commodity, projected)

        explanations = []
        if explain:
            hs = [target_h] + ([advice["recommended_horizon_days"]]
                               if advice["recommended_horizon_days"] not in (0, target_h) else [])
            try:
                explanations = self._explain(X, hs, origin, p0, ref.commodity, origin_date,
                                             projected)
            except Exception:  # never fabricate reasons; the API reports "no explanation"
                log.exception("SHAP explanation failed")

        ro = pd.Timestamp(ref_origin_date)
        hist = series[(series["Date"] <= ro) & (series["Date"] > ro - pd.Timedelta(days=HISTORY_DAYS))
                      & series["observed"]]
        end = ro + pd.Timedelta(days=len(shown))
        after = series[(series["Date"] > ro) & (series["Date"] <= end) & series["observed"]]
        if projected:
            after = after.iloc[0:0]  # the future is unknown, nothing to compare against
        # for a projection the history is the reference season, moved to the requested year
        # and scaled by the same price-level factor so it lines up with the forecast
        history = [{"date": _shift_years(d.date(), years_ahead).isoformat(),
                    "price": round(float(p) * level, 2)}
                   for d, p in zip(hist["Date"], hist["price"])]
        for p in path:
            p.pop("_band")

        return {
            "series": {"state": ref.state, "market": ref.market, "commodity": ref.commodity,
                       "variety": ref.variety},
            "input_date": input_date.isoformat(),
            "forecast_origin_date": origin_date.isoformat(),
            "target_date": target_date.isoformat(),
            "target_horizon_days": target_h,
            "current_price": round(p0, 2),
            "arrivals_used": (None if pd.isna(origin["log_arrivals"])
                              else round(float(np.expm1(origin["log_arrivals"])), 2)),
            "target": path[target_h - 1],
            "path": shown,
            "last_validated_days": last_validated,
            "validated_days": len(validated),
            "max_horizon_days": self.max_horizon,
            "advice": advice,
            "explanations": explanations,
            "history": history,
            "history_is_reference": projected,
            "actual_after_origin": [{"date": d.date().isoformat(), "price": round(float(p), 2)}
                                    for d, p in zip(after["Date"], after["price"])],
            "model": {"version": self.version, "algorithm": self._algorithm(target_h),
                      "approach": self.meta.get("approach", ""),
                      "data_end": self.data_end.isoformat()},
            "projection": {"reference_origin_date": ref_origin_date.isoformat(),
                           "reference_price": round(ref_p0, 2),
                           "years_ahead": years_ahead,
                           "inflation_annual_pct": round(self.inflation * 100, 2),
                           "price_level_factor": round(level, 4)} if projected else None,
            "disclaimer": DISCLAIMER,
        }

    def _algorithm(self, h: int) -> str:
        return _algorithm_name(self.meta, self.horizon_models[h])

    def _explain(self, X: pd.DataFrame, horizons: list[int], origin: pd.Series, p0: float,
                 commodity: str, origin_date: date, projected: bool) -> list[dict]:
        """SHAP explanation of the forecast for the given horizons."""
        out = []
        for h in horizons:
            c = self.horizon_models[h]
            row = X.iloc[[h - 1]]
            explainer = self.explainers[c]
            sv = np.asarray(explainer.shap_values(row))[0]
            base = float(np.atleast_1d(explainer.expected_value)[0])
            if self.rate_form[c]:  # the model explains the daily rate; the forecast is h x rate
                sv, base = sv * h, base * h
            values = {**origin[FEATURE_COLUMNS].to_dict(), **row.iloc[0].to_dict()}
            target = origin_date + timedelta(days=h)
            out.append({"horizon_days": h, "date": target.isoformat(),
                        **explain_price(sv, base, values, self.feature_columns,
                                        origin_date.month, p0, commodity, horizon=h,
                                        target_month=target.month, projected=projected)})
        return out


def _algorithm_name(meta: dict, candidate: str) -> str:
    c = meta["candidates"][candidate]
    return c["algorithm"] + (" (daily-rate form)" if c["target_form"] == "rate" else "")


def _default_variety(rows: pd.DataFrame) -> str:
    """The aggregate series when it exists, else the variety with the most price reports."""
    if (rows["Variety"] == STATE_VARIETY).any():
        return STATE_VARIETY
    return str(rows.sort_values(["observations", "Variety"], ascending=[False, True])
               ["Variety"].iloc[0])


def _shift_years(d: date, years: int) -> date:
    """Same calendar day ``years`` later (or earlier); 29 Feb falls back to 28 Feb."""
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)


def _load_inflation() -> float:
    """Annual inflation assumption shared with the monthly price model."""
    try:
        meta = json.loads((paths.MONTHLY_PRICE_MODEL_DIR / "metadata.json").read_text(encoding="utf-8"))
        return float(meta["inflation_annual"])
    except (OSError, KeyError, ValueError):
        return DEFAULT_INFLATION
