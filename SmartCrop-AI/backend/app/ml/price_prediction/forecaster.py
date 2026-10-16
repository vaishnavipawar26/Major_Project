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
                                              compute_features, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_prediction.selling_advice import best_time_to_sell

log = logging.getLogger(__name__)

HISTORY_DAYS = 60
MAX_OTHER_MARKETS = 6      # other markets tried, most reports first
MIN_BASELINE_OBS = 3       # reports needed for a historical estimate
BASELINE_WINDOW_DAYS = 10  # +- days around a date of an earlier year when measuring seasonal change
BASELINE_SEASON_YEARS = 3  # earlier years looked at
BASELINE_ANCHOR_OBS = 10   # latest reports whose median is the starting price level
BASELINE_STABLE_PCT = 5.0  # a change smaller than this is called stable
MIN_LISTED_OBS = 30        # a market is listed for forecasting from this many reporting days
                           # (training still needs MIN_SERIES_OBS, see scripts/prepare_price_data.py)
PROJECTION_END = date(2027, 12, 31)  # latest date a seasonal projection may start from
DEFAULT_INFLATION = 0.05  # used only if the monthly model's inflation assumption is missing
MIN_RESIDUAL_SAMPLES = 200  # crop-specific error band needs at least this many CV errors
DISCLAIMER = ("This is a model-based estimate and actual market prices may differ. "
              "It is not a guarantee.")


class ForecastError(Exception):
    """Input is valid but a forecast cannot be produced honestly (e.g. too little data)."""


class _Unusable(ForecastError):
    """This one series cannot support this method; the next source or method is tried."""


@dataclass
class _Ctx:
    """The dates of one forecast, kept apart: the forecast start (today), the seasonal reference
    date (the cut-off for history, in the dataset) and how far the reference was shifted."""
    input_date: date
    ref_date: date
    years_ahead: int
    level: float


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
        sup = self.support[self.support["observations"] >= MIN_LISTED_OBS]
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
                "unsupported_series": int((self.support["observations"] < MIN_LISTED_OBS).sum()),
                "min_listed_days": MIN_LISTED_OBS}

    def default_variety(self, state: str, market: str, commodity: str) -> str:
        rows = self.support[(self.support["State"] == state) & (self.support["Market"] == market)
                            & (self.support["Commodity"] == commodity)]
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
        s = self._series.get((ref.state, ref.market, ref.commodity, ref.variety))
        if s is None:
            raise _Unusable("No price history exists for this state / market / crop combination.")
        return s

    def _interval(self, h: int, commodity: str) -> dict:
        iv = self.meta["residual_intervals"][str(h)]
        c = iv.get(commodity)
        return c if c and c.get("n", 0) >= MIN_RESIDUAL_SAMPLES else iv["_all"]

    def _reference_date(self, as_of: date) -> tuple[date, int]:
        """Seasonal reference date inside the dataset, and how many years it was shifted.

        Dates after ``data_end`` have no observed prices, so the same calendar day in the
        latest dataset year is used instead: its lags, rolling means, arrivals and seasonal
        features describe the same point in the crop's yearly cycle. This is *not* the
        forecast start date and not the latest date of any series: it is only the cut-off
        for the history a forecast may use (nothing after it is ever read)."""
        years = 0
        ref = as_of
        while ref > self.data_end:
            years += 1
            ref = _shift_years(as_of, -years)
        return ref, years

    # ------------------------------------------------------------------ source selection
    def _candidates(self, ref: SeriesRef) -> list[tuple[str, SeriesRef]]:
        """Series to forecast from, best first: the selected market, the state median of the
        same crop, then other markets of the same crop (most reports first). Never another crop."""
        out: list[tuple[str, SeriesRef]] = []
        seen = set()

        def add(kind: str, r: SeriesRef) -> None:
            key = (r.state, r.market, r.commodity, r.variety)
            if key in self._series and key not in seen:
                seen.add(key)
                out.append((kind, r))

        add("market" if ref.market != STATE_MARKET else "state_median", ref)
        add("state_median", SeriesRef(ref.state, STATE_MARKET, ref.commodity, STATE_VARIETY))
        rows = self.support[(self.support["State"] == ref.state)
                            & (self.support["Commodity"] == ref.commodity)
                            & (self.support["Market"] != STATE_MARKET)
                            & (self.support["Market"] != ref.market)]
        rows = rows.sort_values(["observations", "Market"], ascending=[False, True])
        for _, g in rows.groupby("Market", sort=False):
            r = g.iloc[0]
            add("other_market", SeriesRef(r["State"], r["Market"], r["Commodity"], r["Variety"]))
            if sum(k == "other_market" for k, _ in out) >= MAX_OTHER_MARKETS:
                break
        return out

    # ------------------------------------------------------------------ forecast
    def forecast(self, ref: SeriesRef, as_of: date, target_date: date,
                 explain: bool = True) -> dict:
        """Forecast for ``ref`` from ``as_of`` to ``target_date``.

        Order of attempts (the first that works is returned, and the response says which):
        the trained models on the selected market, on the state median, on another market of
        the same crop; then, only if no model can run, a historical estimate from the same
        sources. ``ForecastError`` is raised only for invalid requests or when the crop has no
        usable price history at all."""
        if as_of < self.data_start or as_of > PROJECTION_END:
            raise ForecastError(f"The forecast date must be between {self.data_start} and "
                                f"{PROJECTION_END}. Prices are observed up to {self.data_end}; "
                                "later dates are seasonal projections.")
        days = (target_date - as_of).days
        if days < 1:
            raise ForecastError("Choose a target date after the forecast date.")
        if days > self.max_horizon:
            raise ForecastError(f"The model forecasts at most {self.max_horizon} days after the "
                                f"forecast date ({as_of}). Choose a target date on or before "
                                f"{as_of + timedelta(days=self.max_horizon)}.")
        ref_date, years = self._reference_date(as_of)
        ctx = _Ctx(input_date=as_of, ref_date=ref_date, years_ahead=years,
                   level=(1 + self.inflation) ** years)
        cands = self._candidates(ref)
        if not cands:
            raise ForecastError("No price history exists for this state / market / crop "
                                "combination.")
        for kind, cref in cands:
            try:
                out = self._forecast_model(cref, ctx, target_date, explain)
            except _Unusable as why:
                log.info("model forecast unavailable for %s: %s", cref, why)
                continue
            return self._with_source(out, kind, cref, ref, "trained_model")
        for kind, cref in cands:
            try:
                out = self._forecast_baseline(cref, ctx, target_date)
            except _Unusable as why:
                log.info("historical estimate unavailable for %s: %s", cref, why)
                continue
            return self._with_source(out, kind, cref, ref, "historical_baseline")
        raise ForecastError(f"There are not enough valid historical {ref.commodity} prices in "
                            "the dataset to calculate a reliable estimate.")

    def _with_source(self, out: dict, kind: str, used: SeriesRef, wanted: SeriesRef,
                     method: str) -> dict:
        series = self._series[(used.state, used.market, used.commodity, used.variety)]
        seen = series.loc[series["observed"], "Date"]
        age = (pd.Timestamp(out["dates"]["reference_date"])
               - pd.Timestamp(out["dates"]["origin_observation_date"])).days
        out["source"] = {
            "kind": kind, "method": method,
            "requested_market": wanted.market, "requested_variety": wanted.variety,
            "used_market": used.market, "used_variety": used.variety,
            "data_age_days": age,
            # a note is shown whenever the forecast is not "this market, recent reports, trained model"
            "fallback": (used.market != wanted.market or method != "trained_model"
                         or age > PRICE_FFILL_LIMIT),
            "observations": int(series["observed"].sum()),
        }
        out["dates"]["latest_data_date"] = seen.max().date().isoformat()
        return out

    @staticmethod
    def _dates(ctx: "_Ctx", target_date: date, origin_obs: date) -> dict:
        return {"forecast_start": ctx.input_date.isoformat(), "target_date": target_date.isoformat(),
                "reference_date": ctx.ref_date.isoformat(),
                "origin_observation_date": origin_obs.isoformat(), "years_shifted": ctx.years_ahead}

    @staticmethod
    def _context(series: pd.DataFrame, ctx: "_Ctx", ref_origin_date: date, n: int,
                 projected: bool) -> tuple[list, list]:
        """Price history shown before the origin, and (for real dates) the prices reported after."""
        ro = pd.Timestamp(ref_origin_date)
        hist = series[(series["Date"] <= ro) & (series["Date"] > ro - pd.Timedelta(days=HISTORY_DAYS))
                      & series["observed"]]
        after = series[(series["Date"] > ro) & (series["Date"] <= ro + pd.Timedelta(days=n))
                       & series["observed"]]
        if projected:
            after = after.iloc[0:0]  # the future is unknown, nothing to compare against
        # for a projection the history is the reference season, moved to the requested year
        # and scaled by the same price-level factor so it lines up with the forecast
        history = [{"date": _shift_years(d.date(), ctx.years_ahead).isoformat(),
                    "price": round(float(p) * ctx.level, 2)}
                   for d, p in zip(hist["Date"], hist["price"])]
        actual = [{"date": d.date().isoformat(), "price": round(float(p), 2)}
                  for d, p in zip(after["Date"], after["price"])]
        return history, actual

    def _forecast_model(self, ref: SeriesRef, ctx: "_Ctx", target_date: date,
                        explain: bool = True) -> dict:
        """Trained-model forecast from the latest complete report at or before the reference date."""
        as_of, years_ahead = ctx.ref_date, ctx.years_ahead
        projected = years_ahead > 0
        level = ctx.level  # price level carried from the reference year to the requested year
        series = self._get_series(ref)
        feats = compute_features(series, self.encoders, with_targets=False)

        # The origin is the latest day on or before the reference date on which the market reported
        # a price AND every lag / rolling feature can be computed from earlier reports. It may be
        # older than a week: features then describe that day, and nothing after it is used.
        usable = feats[(feats["Date"] <= pd.Timestamp(as_of)) & usable_origin_mask(feats)]
        if usable.empty:
            raise _Unusable("This series has no day with enough continuous price history "
                            "(about 30 days of reports) before the reference date.")
        origin = usable.iloc[-1]

        ref_p0 = float(origin["price"])
        p0 = ref_p0 * level
        ref_origin_date = origin["Date"].date()
        origin_date = _shift_years(ref_origin_date, years_ahead)
        target_h = (target_date - origin_date).days
        if target_h < 1:
            raise _Unusable("The latest usable report is later than the target date.")
        if target_h > self.max_horizon:
            raise _Unusable(f"The latest usable report ({origin_date}) is more than "
                            f"{self.max_horizon} days before the target date.")

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

        history, actual_after = self._context(series, ctx, ref_origin_date, len(shown), projected)
        for p in path:
            p.pop("_band")

        return {
            "series": {"state": ref.state, "market": ref.market, "commodity": ref.commodity,
                       "variety": ref.variety},
            "input_date": ctx.input_date.isoformat(),
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
            "actual_after_origin": actual_after,
            "model": {"version": self.version, "algorithm": self._algorithm(target_h),
                      "approach": self.meta.get("approach", ""),
                      "data_end": self.data_end.isoformat()},
            "projection": {"reference_origin_date": ref_origin_date.isoformat(),
                           "reference_price": round(ref_p0, 2),
                           "years_ahead": years_ahead,
                           "inflation_annual_pct": round(self.inflation * 100, 2),
                           "price_level_factor": round(level, 4)} if projected else None,
            "dates": self._dates(ctx, target_date, ref_origin_date),
            "disclaimer": DISCLAIMER,
        }

    # ------------------------------------------------------------------ historical estimate
    @staticmethod
    def _window_median(dates: np.ndarray, prices: np.ndarray, centre: date) -> float | None:
        near = np.abs((dates - np.datetime64(centre)).astype(int)) <= BASELINE_WINDOW_DAYS
        return float(np.median(prices[near])) if near.sum() >= MIN_BASELINE_OBS else None

    def _seasonal_ratio(self, obs: pd.DataFrame, ref_date: date, h: int) -> tuple[float, int]:
        """Typical price change over ``h`` days at this time of year: for each earlier year, the
        median report around (reference date + h) divided by the median around the reference date,
        then the median of those ratios. Only reports before the reference date are read (earlier
        years), so nothing from the future leaks in. Returns (ratio, years used); (1.0, 0) = flat."""
        dates = obs["Date"].to_numpy("datetime64[D]")
        prices = obs["price"].to_numpy(float)
        ratios = []
        for k in range(1, BASELINE_SEASON_YEARS + 1):
            then = _shift_years(ref_date, -k)
            a = self._window_median(dates, prices, then)
            b = self._window_median(dates, prices, then + timedelta(days=h))
            if a and b:
                ratios.append(b / a)
        return (float(np.median(ratios)), len(ratios)) if ratios else (1.0, 0)

    @staticmethod
    def _log_spread(obs: pd.DataFrame) -> float:
        """Typical weekly log price change (standard deviation) of the reported prices."""
        weekly = obs.set_index("Date")["price"].resample("W").median().dropna()
        if len(weekly) < 8:
            return 0.1
        return max(float(np.log(weekly).diff().dropna().std()), 0.02)

    def _forecast_baseline(self, ref: SeriesRef, ctx: "_Ctx", target_date: date) -> dict:
        """Indicative estimate from historical prices when no trained model can run: the latest
        reported price level, moved to the forecast year with the annual inflation assumption
        (once, as the model path does) and by the typical seasonal change seen in earlier years.
        It is not a model prediction and is never marked as validated."""
        series = self._get_series(ref)
        projected = ctx.years_ahead > 0
        cut = pd.Timestamp(ctx.ref_date)
        known = series[series["observed"] & (series["Date"] <= cut) & series["price"].notna()
                       & (series["price"] > 0)]
        if len(known) < MIN_BASELINE_OBS:
            raise _Unusable("Too few valid price reports before the reference date.")
        obs = known[["Date", "price"]].reset_index(drop=True)
        anchor = float(obs["price"].iloc[-BASELINE_ANCHOR_OBS:].median())
        p0 = anchor * ctx.level
        spread = self._log_spread(obs)
        band = math.log(1 + BASELINE_STABLE_PCT / 100)
        start = ctx.input_date
        path = []
        for h in HORIZONS:
            ratio, _years = self._seasonal_ratio(obs, ctx.ref_date, h)
            mid = p0 * ratio
            width = 1.2816 * spread * math.sqrt(h / 7)  # central 80 % of a normal weekly-change model
            chg = math.log(ratio)
            path.append({
                "horizon_days": h, "date": (start + timedelta(days=h)).isoformat(),
                "predicted_price": round(mid, 2),
                "lower": round(mid * math.exp(-width), 2), "upper": round(mid * math.exp(width), 2),
                "change_pct": round((ratio - 1) * 100, 2),
                "stable_band_pct": BASELINE_STABLE_PCT,
                "direction": "Stable" if abs(chg) < band else ("Increasing" if chg > 0 else "Decreasing"),
                "actual_price": None, "beats_baseline": False,
                "model_mae": None, "baseline_mae": None, "_band": band,
            })
        target_h = (target_date - start).days
        shown = path[:target_h]
        advice = best_time_to_sell(shown, target_h, ref.commodity, projected)
        ref_origin = known["Date"].iloc[-1].date()
        history, actual_after = self._context(series, ctx, ref_origin, len(shown), projected)
        # the real prices reported on the days that were forecast, when they are in the dataset
        if not projected:
            tp = series.set_index("Date")["price"]
            for p in path:
                v = tp.get(pd.Timestamp(p["date"]))
                p["actual_price"] = None if v is None or pd.isna(v) else round(float(v), 2)
        for p in path:
            p.pop("_band")
        return {
            "series": {"state": ref.state, "market": ref.market, "commodity": ref.commodity,
                       "variety": ref.variety},
            "input_date": ctx.input_date.isoformat(),
            "forecast_origin_date": start.isoformat(),
            "target_date": target_date.isoformat(),
            "target_horizon_days": target_h,
            "current_price": round(p0, 2),
            "arrivals_used": None,
            "target": path[target_h - 1],
            "path": shown,
            "last_validated_days": 0, "validated_days": 0,
            "max_horizon_days": self.max_horizon,
            "advice": advice, "explanations": [],
            "history": history, "history_is_reference": projected,
            "actual_after_origin": actual_after,
            "model": {"version": self.version, "algorithm": "Historical price estimate (no model)",
                      "approach": ("Latest reported price level, moved to the requested year with the "
                                   "annual inflation assumption and by the typical seasonal change "
                                   "seen in earlier years. Not a trained-model prediction."),
                      "data_end": self.data_end.isoformat()},
            "projection": None,
            "dates": self._dates(ctx, target_date, ref_origin),
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
