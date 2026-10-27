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
from app.ml.explainability import price_explainer_v3 as v3x
from app.ml.explainability.price_charts import build_charts
from app.ml.explainability.price_explainer import explain_price
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import (FEATURE_COLUMNS, HORIZONS, MAX_HORIZON,
                                              PRICE_FFILL_LIMIT, SERIES_KEY, STATE_MARKET,
                                              STATE_VARIETY, TARGET_FFILL_LIMIT,
                                              compute_features, usable_origin_mask,
                                              with_pair_features)
from app.ml.price_prediction.selling_advice import best_time_to_sell, no_direction_advice
from app.ml.price_prediction.verdict import horizon_info, latest_recorded as aged_latest, price_verdict
from app.ml.price_prediction.weather_features import WEATHER_FEATURES, attach

log = logging.getLogger(__name__)

HISTORY_DAYS = 60
EARLIER_YEARS = 5           # how many earlier years the "same time in earlier years" fallback looks back
EARLIER_WINDOW_DAYS = 7     # reported prices within this many days of the target date count for a year
EARLIER_MIN_REPORTS = 3
CHART_AFTER_DAYS = 14        # the chart continues this many days past the selected date so later selling dates can be compared
EARLIER_STEP_DAYS = 7       # earlier-year prices are also returned every 7 days around the target date
EARLIER_STEPS = 9           # ... for this many steps before and after it
EARLIER_POINT_WINDOW_DAYS = 3
REFERENCE_NEAR_DAYS = 3     # last year's rows are returned this many days past the target so a day without a report can use its neighbours
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
RANGE_MIN_SHOWN_COVERAGE = 40.0  # a range whose measured coverage (crop x band backtest) is below this is hidden
DISCLAIMER = ("This is a model-based estimate and actual market prices may differ. "
              "It is not a guarantee.")


class ForecastError(Exception):
    """Input is valid but a forecast cannot be produced honestly (e.g. too little data)."""


class ModelSchemaError(RuntimeError):
    """A model artifact does not match the feature schema it was saved with."""


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
    latest: dict | None = None     # the one "latest recorded price" of the requested market (see verdict.py)


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
        self._check_schema()
        self.explainers = {c: shap.TreeExplainer(m) for c, m in self.models.items()}
        # weather inputs exist only if the model was trained with them; then the daily weather
        # feature table (built offline, no network at serving time) is joined at the origin day
        self.uses_weather = any(f in WEATHER_FEATURES for f in self.feature_columns)
        self.weather_feats = None
        if self.uses_weather:
            wp = paths.DATASET_DIR / "weather" / "weather_features_daily.parquet"
            if not wp.exists():
                raise ModelSchemaError("The model was trained with weather features but "
                                       f"{wp} is missing; rebuild it (scripts.build_weather_features).")
            self.weather_feats = pd.read_parquet(wp)
        cal = d / "explanation_calibration.json"
        self.calibration = json.loads(cal.read_text(encoding="utf-8")) if cal.exists() else None
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
        self.crop_cv_n = {(int(r.horizon), r.commodity): int(r.n) for r in pc.itertuples()}
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
        # backtest reliability per crop x horizon band (built by scripts/build_reliability_table.py); optional
        rt = paths.MODELS_DIR / "price_reliability" / "reliability_v1.json"
        self.reliability_table = json.loads(rt.read_text(encoding="utf-8")) if rt.exists() else None
        # crops for which validation showed the model should not be used to claim a direction (strategy "no_change")
        cp = paths.MODELS_DIR / "price_reliability" / "crop_policy.json"
        self.crop_policy = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else {"no_change_crops": []}

    def _check_schema(self) -> None:
        """Refuse to serve a model whose input columns differ from the saved feature list."""
        want = self.meta.get("feature_columns") or self.feature_columns
        if list(want) != list(self.feature_columns):
            raise ModelSchemaError("metadata.json and price_preprocessing.joblib list different "
                                   "feature columns; retrain with scripts.train_price_model.")
        for c, m in self.models.items():
            n = getattr(m, "n_features_in_", len(self.feature_columns))
            if n != len(self.feature_columns):
                raise ModelSchemaError(f"model {c} expects {n} inputs but the feature schema has "
                                       f"{len(self.feature_columns)}; retrain or restore matching artifacts.")

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
        # Freshness gate (app/ml/price_prediction/freshness.py): with records at most 60 days old the forecast starts
        # from the latest real price instead of replaying the same season of an earlier year. Off while data are stale.
        gate = freshness.gate_active(freshness.gate_mode(), as_of, self.data_end)
        if gate and as_of > self.data_end:
            ref_date, years = self.data_end, 0
        else:
            ref_date, years = self._reference_date(as_of)
        ctx = _Ctx(input_date=as_of, ref_date=ref_date, years_ahead=years,
                   level=(1 + self.inflation) ** years, latest=self.latest_for(ref, as_of))
        cands = self._candidates(ref)
        if not cands:
            raise ForecastError("No price history exists for this state / market / crop "
                                "combination.")
        stale_note = None
        if gate:
            cands, stale_note = self._apply_freshness(cands, ref, ctx.ref_date, as_of)
        for kind, cref in cands:
            try:
                out = self._forecast_model(cref, ctx, target_date, explain)
            except _Unusable as why:
                log.info("model forecast unavailable for %s: %s", cref, why)
                continue
            return self._with_note(self._with_source(out, kind, cref, ref, "trained_model"), stale_note)
        for kind, cref in cands:
            try:
                out = self._forecast_baseline(cref, ctx, target_date)
            except _Unusable as why:
                log.info("historical estimate unavailable for %s: %s", cref, why)
                continue
            return self._with_note(self._with_source(out, kind, cref, ref, "historical_baseline"), stale_note)
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
        if used.market != wanted.market:
            why = ("the Maharashtra median is used because this market has too little recent price history" if kind == "state_median"
                   else "another market's prices are used because this market has too little recent price history")
            self._set_market_note(out, f"You selected {wanted.market}; {why}.")
        return out

    @staticmethod
    def _set_market_note(out: dict, note: str) -> None:
        for e in out.get("explanations", []):
            v3 = e.get("v3")
            if v3 and v3.get("market_breakdown") is not None:
                v3["market_breakdown"]["note"] = note

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

    @staticmethod
    def _reference_after(series: pd.DataFrame, ctx: "_Ctx", ref_origin_date: date, target_h: int, projected: bool) -> list[dict]:
        """For a projection: last year's reported prices from the day after the reference origin to ``target_h`` days
        (plus REFERENCE_NEAR_DAYS, so a date without a report can use its neighbours), moved to the requested
        year and price level exactly like ``history``. Empty for real dates, whose later prices are ``actual_after_origin``."""
        if not projected:
            return []
        ro = pd.Timestamp(ref_origin_date)
        rows = series[(series["Date"] > ro) & (series["Date"] <= ro + pd.Timedelta(days=target_h + REFERENCE_NEAR_DAYS)) & series["observed"]]
        return [{"date": _shift_years(d.date(), ctx.years_ahead).isoformat(), "price": round(float(p) * ctx.level, 2)}
                for d, p in zip(rows["Date"], rows["price"])]

    def _earlier_years(self, series: pd.DataFrame, target_date: date) -> list[dict]:
        """The price around the target date's calendar day in each earlier year, moved to the target year's price level
        with the app's inflation assumption. It is history, not a forecast: the page draws it when no forecast is shown.
        A year with fewer than EARLIER_MIN_REPORTS reports in the window is left out."""
        out = []
        for k in range(1, EARLIER_YEARS + 1):
            centre = _shift_years(target_date, -k)
            lo, hi = pd.Timestamp(centre) - pd.Timedelta(days=EARLIER_WINDOW_DAYS), pd.Timestamp(centre) + pd.Timedelta(days=EARLIER_WINDOW_DAYS)
            obs = series[series["observed"] & (series["Date"] >= lo) & (series["Date"] <= hi)]["price"].dropna()
            if len(obs) < EARLIER_MIN_REPORTS:
                continue
            raw = float(obs.mean())
            # the same year every 7 days around the target date: how the price moved in the weeks before and after it
            weekly = {}
            for step in range(-EARLIER_STEPS, EARLIER_STEPS + 1):
                c = pd.Timestamp(centre) + pd.Timedelta(days=step * EARLIER_STEP_DAYS)
                w = series[series["observed"] & (series["Date"] >= c - pd.Timedelta(days=EARLIER_POINT_WINDOW_DAYS))
                           & (series["Date"] <= c + pd.Timedelta(days=EARLIER_POINT_WINDOW_DAYS))]["price"].dropna()
                if len(w) >= 2:
                    weekly[str(step * EARLIER_STEP_DAYS)] = round(float(w.mean()) * (1 + self.inflation) ** k, 2)
            out.append({"year": centre.year, "date": centre.isoformat(), "price": round(raw * (1 + self.inflation) ** k, 2),
                        "raw_price": round(raw, 2), "n": int(len(obs)), "weekly": weekly})
        return out

    def _forecast_model(self, ref: SeriesRef, ctx: "_Ctx", target_date: date,
                        explain: bool = True) -> dict:
        """Trained-model forecast from the latest complete report at or before the reference date."""
        as_of, years_ahead = ctx.ref_date, ctx.years_ahead
        projected = years_ahead > 0
        level = ctx.level  # price level carried from the reference year to the requested year
        series = self._get_series(ref)
        feats = compute_features(series, self.encoders, with_targets=False)
        if self.uses_weather:
            feats = attach(feats, self.weather_feats)

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
                "beats_baseline": h in validated and self.policy_for(ref.commodity, h)["mode"] == "model",
                "model_mae": round(model_mae, 1), "baseline_mae": round(base_mae, 1),
                "_band": band,
            })

        # show dates up to the target and, beyond it, up to the last validated date
        last_validated = max(validated, default=0)
        shown = path[:max(target_h, last_validated)]
        horizon = horizon_info((target_date - ctx.input_date).days, ref_origin_date, target_h)
        cell_t, scope_t = self.reliability_cell(ref.commodity, target_h, projected)
        policy_t = self.policy_for(ref.commodity, target_h, cell_t)
        # context-only cells make no claim about the model's price, so they carry no verdict
        verdict = (None if policy_t["mode"] == "context_only"
                   else price_verdict(p0, path[target_h - 1]["predicted_price"], self.typical_miss(ref.commodity, target_h, projected)))
        advice = (no_direction_advice(shown, target_h, ref.commodity) if policy_t["mode"] == "context_only"
                  else best_time_to_sell(shown, target_h, ref.commodity, projected))
        cov = None if cell_t is None else cell_t["range_coverage_pct"]
        range_info = {"coverage_pct": None if cov is None else round(cov, 1), "n": None if cell_t is None else cell_t["n"],
                      "scope": scope_t, "min_coverage_to_show_pct": RANGE_MIN_SHOWN_COVERAGE,
                      "shown": cov is None or cov >= RANGE_MIN_SHOWN_COVERAGE,
                      "typical_miss_inr": None if cell_t is None else round(cell_t["mae"], 1)}

        explanations = []
        if explain:
            hs = [target_h] + ([advice["recommended_horizon_days"]]
                               if advice["recommended_horizon_days"] not in (0, target_h) else [])
            try:
                evidence = self._evidence_context(series, origin, ref_origin_date, ref, ref_p0)
                state_prices = self._state_prices(ref, ctx, target_date)
                explanations = self._explain(X, hs, origin, p0, ref.commodity, origin_date,
                                             projected, evidence, path, series=series, ref=ref,
                                             ref_origin_date=ref_origin_date, ctx=ctx,
                                             state_prices=state_prices, horizon=horizon)
            except Exception:  # never fabricate reasons; the API reports "no explanation"
                log.exception("SHAP explanation failed")

        chart_h = min(target_h + CHART_AFTER_DAYS, len(path))     # the chart (and later-date comparisons) run past the selected date
        history, actual_after = self._context(series, ctx, ref_origin_date, chart_h, projected)
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
            "policy": policy_t, "range_info": range_info, "verdict": verdict, "horizon": horizon,
            "latest_recorded": ctx.latest,
            "explanations": explanations,
            "history": history,
            "history_is_reference": projected,
            "actual_after_origin": actual_after,
            "earlier_years": self._earlier_years(series, target_date),
            "reference_after": self._reference_after(series, ctx, ref_origin_date, chart_h, projected),
            "chart_path": path, "chart_end_date": path[chart_h - 1]["date"],
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

    def _seasonal_ratios(self, obs: pd.DataFrame, ref_date: date, h: int) -> list[float]:
        """The change over ``h`` days at this time of year in each earlier year (see ``_seasonal_ratio``)."""
        dates = obs["Date"].to_numpy("datetime64[D]")
        prices = obs["price"].to_numpy(float)
        ratios = []
        for k in range(1, BASELINE_SEASON_YEARS + 1):
            then = _shift_years(ref_date, -k)
            a = self._window_median(dates, prices, then)
            b = self._window_median(dates, prices, then + timedelta(days=h))
            if a and b:
                ratios.append(b / a)
        return ratios

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
        chart_h = min(target_h + CHART_AFTER_DAYS, len(path))
        history, actual_after = self._context(series, ctx, ref_origin, chart_h, projected)
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
            "policy": self.policy_for(ref.commodity, target_h), "range_info": None, "verdict": None,
            "horizon": horizon_info((target_date - ctx.input_date).days, ref_origin, target_h),
            "latest_recorded": ctx.latest,
            "history": history, "history_is_reference": projected,
            "actual_after_origin": actual_after,
            "earlier_years": self._earlier_years(series, target_date),
            "reference_after": self._reference_after(series, ctx, ref_origin, chart_h, projected),
            "chart_path": path, "chart_end_date": path[chart_h - 1]["date"],
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

    # ------------------------------------------------------------------ freshness gate
    @staticmethod
    def _last_report(series: pd.DataFrame | None, ref_date: date) -> date | None:
        if series is None:
            return None
        d = series.loc[series["observed"] & (series["Date"] <= pd.Timestamp(ref_date)), "Date"]
        return None if d.empty else d.max().date()

    def _apply_freshness(self, cands: list, ref: SeriesRef, ref_date: date, as_of: date) -> tuple[list, str | None]:
        """Order / refuse candidate series by the age of their latest price (see freshness.py).
        Age is measured from the forecast start date (``as_of``), not from the end of the dataset."""
        def age_of(cref: SeriesRef) -> tuple[int, date | None]:
            last = self._last_report(self._series.get((cref.state, cref.market, cref.commodity, cref.variety)), ref_date)
            return ((as_of - last).days if last else 10 ** 6), last

        kind0, cref0 = cands[0]
        age, last = age_of(cref0)
        decision = freshness.market_decision(age)
        if decision == "no_recent_data":
            raise ForecastError(f"No recent data for this market: its latest price is "
                                f"{'missing' if last is None else f'{age} days old (reported {last.isoformat()})'}.")
        if decision == "use_state_median" and kind0 == "market":
            rest = [c for c in cands[1:] if c[0] == "state_median"] + [c for c in cands[1:] if c[0] != "state_median"]
            if not rest:
                raise ForecastError(f"No recent data for this market: its latest price is {age} days old.")
            s_age, s_last = age_of(rest[0][1])
            if freshness.market_decision(s_age) == "no_recent_data":
                raise ForecastError("No recent data for this market or for Maharashtra as a whole.")
            return rest, (f"The latest price for {ref.market} is {age} days old (reported {last.isoformat()}), "
                          f"so the latest Maharashtra median price (reported {s_last.isoformat()}) is used instead.")
        return cands, None

    @staticmethod
    def _with_note(out: dict, note: str | None) -> dict:
        if note:
            out["source"]["note"] = note
            out["source"]["fallback"] = True
            PriceForecaster._set_market_note(out, note)
        return out

    # ------------------------------------------------------------------ evidence-first explanation (v3)
    def _state_prices(self, ref: SeriesRef, ctx: "_Ctx", target_date: date) -> dict | None:
        """Predicted state-median price per date for the same crop and start (the "median market" in the breakdown)."""
        if ref.market == STATE_MARKET:
            return None
        sref = SeriesRef(ref.state, STATE_MARKET, ref.commodity, STATE_VARIETY)
        if (sref.state, sref.market, sref.commodity, sref.variety) not in self._series:
            return None
        try:
            o = self._forecast_model(sref, ctx, target_date, explain=False)
        except (_Unusable, ForecastError):
            return None
        return {p["date"]: p["predicted_price"] for p in o["path"]}

    def policy_for(self, crop: str, h: int, cell: dict | None = None) -> dict:
        """{"mode": "model" | "context_only", "band", "reasons"} for a crop and horizon (crop_policy.json, built by
        scripts/build_crop_policy.py). Without a policy file: context-only when the backtest cell, or else the
        cross-validated "beats no-change" flag, says the model does not beat its baseline."""
        band = v3x.band_name(h)
        pol = self.crop_policy.get("cells", {}).get(f"{crop}|{band}")
        if pol is not None:
            return {"mode": pol["mode"], "band": band, "reasons": pol["reasons"]}
        beats = cell["beats_baseline"] if cell else (h in set(self.validated_horizons(crop)))
        listed = crop in set(self.crop_policy.get("no_change_crops", []))
        return {"mode": "context_only" if (listed or beats is False) else "model", "band": band,
                "reasons": ["No policy file; decided from the available backtest figures."]}

    def typical_miss(self, crop: str, h: int, projected: bool) -> float | None:
        """Mean absolute backtest error (rupees per quintal) for this crop and distance band; what "about the same" is measured against."""
        cell, _ = self.reliability_cell(crop, h, projected)
        return cell["mae"] if cell else self.reliability(h, crop)[0]

    def latest_for(self, ref: SeriesRef, as_of: date) -> dict | None:
        """THE latest recorded price for a request: the requested market's last report, else the Maharashtra median's.
        The result page, the explanation and the history all read this, so they show the same price and date."""
        r = (self.latest_recorded(ref.state, ref.market, ref.commodity, ref.variety)
             or self.latest_recorded(ref.state, STATE_MARKET, ref.commodity, STATE_VARIETY))
        return None if r is None else aged_latest(r["price"], date.fromisoformat(r["date"]), as_of)

    def saved_view(self, state: str, market: str, commodity: str, variety: str, input_date: date, horizon_days: int,
                   origin_date: date, current_price: float, predicted_price: float) -> dict:
        """Display facts for a saved prediction, by the same rules as a fresh one: the distance band counts from the market's last
        report (``origin_date``), exactly as the forecast did, not from the day it was made."""
        target_h = (input_date + timedelta(days=horizon_days) - origin_date).days
        projected = origin_date > self.data_end
        cell, _ = self.reliability_cell(commodity, target_h, projected)
        ref = SeriesRef(state, market, commodity, variety)
        policy = self.policy_for(commodity, target_h, cell)
        return {"policy": policy,
                "verdict": (None if policy["mode"] == "context_only"
                            else price_verdict(current_price, predicted_price, self.typical_miss(commodity, target_h, projected))),
                "latest_recorded": self.latest_for(ref, input_date)}

    def latest_recorded(self, state: str, market: str, commodity: str, variety: str) -> dict | None:
        """The last price actually reported by this series (its real date), whatever today's date is."""
        s = self._series.get((state, market, commodity, variety))
        if s is None:
            return None
        o = s[s["observed"] & s["price"].notna()]
        if o.empty:
            return None
        r = o.iloc[-1]
        return {"price": round(float(r["price"]), 2), "date": r["Date"].date().isoformat()}

    def observed_prices(self, state: str, market: str, commodity: str, variety: str, days: int = 240) -> list[dict]:
        """Prices this series really reported during its last ``days`` days of records (no filling, no inflation).
        Days without a report are simply absent."""
        s = self._series.get((state, market, commodity, variety))
        if s is None:
            return []
        o = s[s["observed"] & s["price"].notna()]
        if o.empty:
            return []
        o = o[o["Date"] > o["Date"].iloc[-1] - pd.Timedelta(days=days)]
        return [{"date": d.date().isoformat(), "price": round(float(p), 2)} for d, p in zip(o["Date"], o["price"])]

    def reliability_cell(self, crop: str, h: int, projected: bool) -> tuple[dict | None, str | None]:
        t = self.reliability_table
        if not t:
            return None, None
        scope = "projection" if projected else "real_origin"
        sc = t["scenarios"].get(scope)
        if not sc:
            return None, None
        cell = sc["cells"].get(f"{crop}|{v3x.band_name(h)}")
        if cell and cell["n"] >= 100:
            return cell, scope
        cell = sc["crops"].get(crop)
        return (cell, scope) if cell else (None, None)

    def _facts_v3(self, series: pd.DataFrame, ref: SeriesRef, ref_origin: date, h: int, origin: pd.Series) -> dict:
        """Dated, measured facts up to the (reference) origin date; nothing after it is read."""
        cut = pd.Timestamp(ref_origin)
        obs = series[series["observed"] & (series["Date"] <= cut)]
        facts: dict = {}
        # supply: arrivals of the last 30 days against the same calendar month of earlier years
        w0 = cut - pd.Timedelta(days=29)
        arr = obs.loc[obs["Date"] >= w0, "arrivals"].dropna()
        if len(arr) >= 5:
            usual, years = [], []
            for k in (1, 2, 3):
                m = obs[(obs["Date"].dt.year == cut.year - k) & (obs["Date"].dt.month == cut.month)]["arrivals"].dropna()
                if len(m) >= 5:
                    usual.append(float(m.mean()))
                    years.append(cut.year - k)
            f = {"start": w0.date(), "end": cut.date(), "mean": float(arr.mean()), "n_days": int(len(arr)),
                 "month": cut.month, "usual": None, "usual_years": [], "pct": None}
            if usual:
                f["usual"], f["usual_years"] = float(np.mean(usual)), years
                f["pct"] = (f["mean"] / f["usual"] - 1) * 100
            facts["supply"] = f
        # market against the Maharashtra median, 90 days
        state = self._series.get((ref.state, STATE_MARKET, ref.commodity, STATE_VARIETY))
        if ref.market != STATE_MARKET and state is not None:
            w90 = cut - pd.Timedelta(days=89)
            m = obs.loc[obs["Date"] >= w90, ["Date", "price"]]
            st = state.set_index("Date")["price_ffill"]
            j = m.assign(state=st.reindex(m["Date"]).to_numpy()).dropna()
            if len(j) >= 10:
                facts["market"] = {"start": j["Date"].min().date(), "end": j["Date"].max().date(), "n_days": int(len(j)),
                                   "market_avg": float(j["price"].mean()), "state_avg": float(j["state"].mean()),
                                   "avg_gap_pct": float((j["price"].mean() / j["state"].mean() - 1) * 100)}
        # recent trend and last-year comparison from the filled daily price
        pf = series.set_index("Date")["price_ffill"]
        now = pf.get(cut)
        if now is not None and pd.notna(now) and now > 0:
            t = {"date": cut.date(), "price": float(now), "d30": None, "d90": None}
            for key, days_ in (("d30", 30), ("d90", 90)):
                prev = pf.get(cut - pd.Timedelta(days=days_))
                if prev is not None and pd.notna(prev) and prev > 0:
                    t[key] = {"date": (cut - pd.Timedelta(days=days_)).date(), "price": float(prev), "pct": float((now / prev - 1) * 100)}
            facts["trend"] = t
            prev = pf.get(cut - pd.Timedelta(days=365))
            if prev is not None and pd.notna(prev) and prev > 0:
                facts["last_year"] = {"date": cut.date(), "price": float(now), "prev_date": (cut - pd.Timedelta(days=365)).date(),
                                      "prev_price": float(prev), "pct": float((now / prev - 1) * 100)}
        # seasonal: what the price did over the next h days in earlier years
        known = obs[obs["price"].notna() & (obs["price"] > 0)]
        if len(known) >= MIN_BASELINE_OBS:
            dates = known["Date"].to_numpy("datetime64[D]")
            prices = known["price"].to_numpy(float)
            yrs = []
            for k in range(1, BASELINE_SEASON_YEARS + 1):
                then = _shift_years(ref_origin, -k)
                a = self._window_median(dates, prices, then)
                b = self._window_median(dates, prices, then + timedelta(days=h))
                if a and b:
                    yrs.append({"year": then.year, "from": then, "to": then + timedelta(days=h), "pct": (b / a - 1) * 100})
            if yrs:
                facts["seasonal"] = {"years": yrs, "mean_pct": float(np.mean([y["pct"] for y in yrs]))}
        vol = origin.get("volatility_30")
        if vol is not None and pd.notna(vol):
            facts["swings"] = {"date": ref_origin, "daily_pct": float(vol) * 100}
        return facts

    def _build_v3(self, series, ref, ref_origin_date, ctx, h, sv, base, values, origin, p0, commodity, projected,
                  point, target, weather_status, model_out, state_prices, horizon=None) -> dict:
        contrib = dict(zip(self.feature_columns, map(float, sv)))
        cell, scope = self.reliability_cell(commodity, h, projected)
        model_mae, _ = self.reliability(h, commodity)
        is_state = ref.market == STATE_MARKET
        st_price = None if state_prices is None else state_prices.get(target.isoformat())
        pol = self.policy_for(commodity, h, cell)
        context_only = pol["mode"] == "context_only"
        reason = (f"In testing, the model did not reliably beat keeping the latest price for {commodity}, "
                  f"{pol['band']} days ahead, so it is not used to predict a rise or fall.") if context_only else None
        out = v3x.build_v3(context_only=context_only, context_reason=reason, 
            contrib=contrib, base_value=float(base), values=values, model_features=set(self.feature_columns),
            facts=self._facts_v3(series, ref, ref_origin_date, h, origin), crop=commodity, market=ref.market,
            requested_market=None, series_is_state=is_state, horizon=h, start_price=p0,
            predicted_price=point["predicted_price"], lower=point["lower"], upper=point["upper"], target_date=target,
            projected=projected, forecast_date=ctx.input_date, ref_origin_date=ref_origin_date,
            inflation_pct=self.inflation * 100 if projected else None, reliability_cell=cell, reliability_scope=scope,
            fallback_mae=model_mae, fallback_beats=h in set(self.validated_horizons(commodity)),
            breakdown=None if st_price is None else {"state_price": st_price}, weather_status=weather_status,
            model_output_log=model_out, latest_recorded=ctx.latest, horizon_info=horizon,
            verdict=price_verdict(p0, point["predicted_price"], self.typical_miss(commodity, h, projected)))
        out["policy"] = pol
        return out

    def _evidence_context(self, series: pd.DataFrame, origin: pd.Series, ref_origin: date,
                          ref: SeriesRef, ref_price: float) -> dict:
        """Measured facts for the explanation, from reports up to the origin day only
        (reference-year values when the forecast is a projection)."""
        cut = pd.Timestamp(ref_origin)
        obs = series[series["observed"] & (series["Date"] <= cut)]
        ctx: dict = {"series_is_state": ref.market == STATE_MARKET, "price_ref": ref_price}
        last = obs[obs["Date"] > cut - pd.Timedelta(days=7)]["price"]
        prev = obs[(obs["Date"] <= cut - pd.Timedelta(days=7))
                   & (obs["Date"] > cut - pd.Timedelta(days=14))]["price"]
        if len(last) >= 3 and len(prev) >= 3:
            ctx["price_7d_avg"], ctx["price_prev_7d_avg"] = float(last.mean()), float(prev.mean())
        year = obs[obs["Date"] > cut - pd.Timedelta(days=365)]["price"]
        if len(year) >= 60:
            ctx["year_median_price"] = float(year.median())
        arr = obs[obs["Date"] > cut - pd.Timedelta(days=30)]["arrivals"].dropna()
        if len(arr) >= 5 and pd.notna(origin.get("arrivals")):
            ctx["arrivals_latest"], ctx["arrivals_30d_mean"] = float(origin["arrivals"]), float(arr.mean())
        a_last = obs[obs["Date"] > cut - pd.Timedelta(days=7)]["arrivals"].dropna()
        a_prev = obs[(obs["Date"] <= cut - pd.Timedelta(days=7)) & (obs["Date"] > cut - pd.Timedelta(days=14))]["arrivals"].dropna()
        if len(a_last) >= 3 and len(a_prev) >= 3:
            ctx["arrivals_7d_mean"], ctx["arrivals_prev_7d_mean"] = float(a_last.mean()), float(a_prev.mean())
            ctx["arrivals_asof"] = cut.date().isoformat()
        known = obs[obs["price"].notna() & (obs["price"] > 0)][["Date", "price"]].reset_index(drop=True)
        ctx["_seasonal_obs"] = {"obs": known, "ref_date": ref_origin}
        return ctx

    def _seasonal_evidence(self, evidence: dict, h: int) -> dict:
        s = evidence.get("_seasonal_obs")
        if s is None or len(s["obs"]) < MIN_BASELINE_OBS:
            return {"ratio": None, "years": 0}
        ratio, years = self._seasonal_ratio(s["obs"], s["ref_date"], h)
        return {"ratio": ratio if years else None, "years": years,
                "ratios": [round(r, 4) for r in self._seasonal_ratios(s["obs"], s["ref_date"], h)]}

    def _explain(self, X: pd.DataFrame, horizons: list[int], origin: pd.Series, p0: float,
                 commodity: str, origin_date: date, projected: bool, evidence: dict,
                 path: list[dict], *, series: pd.DataFrame | None = None, ref: SeriesRef | None = None,
                 ref_origin_date: date | None = None, ctx: "_Ctx | None" = None,
                 state_prices: dict | None = None, horizon: dict | None = None) -> list[dict]:
        """SHAP explanation of the forecast for the given horizons (legacy fields + the evidence-first ``v3`` block)."""
        ctx_run = ctx            # the loop below reuses the name ``ctx`` for the legacy evidence context
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
            model_mae, base_mae = self.reliability(h, commodity)
            ctx = {**{k: v for k, v in evidence.items() if not k.startswith("_")},
                   "data_end": self.meta["data_end"],
                   "reliability": {"model_mae": round(model_mae, 1), "baseline_mae": round(base_mae, 1),
                                   "validated": h in set(self.validated_horizons(commodity))},
                   "seasonal": self._seasonal_evidence(evidence, h)}
            weather_status = "not_used"
            if self.uses_weather:
                weather_status = ("used" if all(pd.notna(values.get(f)) for f in WEATHER_FEATURES)
                                  else "unavailable")
            model_out = float(self._predict(row)[0])
            entry = {"horizon_days": h, "date": target.isoformat(),
                     "algorithm": self._algorithm(h),   # the model that actually produced (and is explained for) this horizon
                     **explain_price(sv, base, values, self.feature_columns,
                                     origin_date.month, p0, commodity, horizon=h,
                                     target_month=target.month, projected=projected,
                                     context=ctx, calibration=self.calibration,
                                     target_point=path[h - 1], weather_status=weather_status,
                                     model_output=model_out,
                                     n_tests=self.crop_cv_n.get((h, commodity)))}
            entry["charts"] = build_charts(sv, base, self.feature_columns, p0,
                                           entry["summary"]["predicted_price"],
                                           self.meta.get("global_shap_importance"))
            if series is not None and ref is not None and ctx_run is not None:
                entry["v3"] = self._build_v3(series, ref, ref_origin_date, ctx_run, h, sv, base, values, origin,
                                             p0, commodity, projected, path[h - 1], target, weather_status,
                                             model_out, state_prices, horizon)
            out.append(entry)
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
