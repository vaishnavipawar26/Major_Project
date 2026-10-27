"""Smart economic crop recommendation for the 7 supported crops.

Scores (each 0-100)
-------------------
Where and when come first, then the field itself, and profit decides between crops that already suit the place and the season.

Location   L = 50 % growing-belt + 50 % local climate.
               growing-belt: the crop's share of the training records from the farmer's city, relative to an even split over the
               supported cities (100 when the city holds at least 1/11 of the crop's records: the crop's main growing belts, see
               DATASET.md). local climate: share of the city's climate normals (mean temperature, humidity and monthly rainfall of
               the growing months starting at the planting month, city_climate_normals.csv) that lie inside the crop's typical
               5th-95th percentile range.
Planting   F = planting-month fit from the crop calendar: 100 in a documented planting month, 50 one month off, else 0.
Selling    S = selling-month fit: 100 if freshly harvested in the selling month, minus 12 per month of storage for storable
               crops, 0 if it would not be ready yet or would have spoiled.
Soil       the share of the farmer's N, P, K and pH values inside the crop's typical 5th-95th percentile range, x 100.
Weather    the same for temperature, humidity and rainfall.
Profit     P = 50 + 50 tanh(ROI) from the profitability engine, using the XGBoost monthly price forecast for the selling month in
               the user's city (0 if infeasible), pulled towards 50 by RELIABILITY_SHRINK when the forecast is not reliable.

Overall    = 0.20 L + 0.20 F + 0.10 S + 0.15 Soil + 0.15 Weather + 0.20 P'

Location, planting and selling timing together carry 50 points, soil and weather 30, profit 20. The XGBoost classifier probability
("model_match_score") is NOT used in the score: it is relative to the other six crops. It (with SHAP) only explains the model.
There is no labelled ground truth for "best crop to plant", so the weights are a documented judgement, not learned;
scripts/score_sensitivity.py reports how rankings change. Timing score T = (F + S) / 2 and the combined agronomic score
A = share of the 7 soil and weather values in range are still reported. P is based on ROI (net profit / total cost), so
"highest profit" and "best overall" can differ and the API explains the difference (ranking_explanation).

Eligibility: a crop is recommended only if the planting month is a documented (or adjacent) planting month for it, it is agronomically viable - at least MIN_RANGE_FIT of
the farmer's 7 soil/weather values lie inside the crop's typical range (each range covers 90 % of
that crop's training rows, so a suitable field normally has about 6 of 7 inside; fewer than 5 is
unusual) - it can actually be sold in the chosen month, AND its expected net profit is positive. A
crop that is expected to lose money is therefore never "recommended" however well its soil/weather
fit scores, and is ranked below every eligible crop. All 7 crops are
still returned (ranked, flagged) so the comparison chart shows every option.

"Best overall" (the first recommended crop, by Overall score) and "highest expected profit" (the
feasible crop with the largest net profit) are reported separately because they can differ: the
highest-profit crop may fit the farmer's soil and weather poorly.

Range fit (the Agronomic score above and the soil/weather counts shown to the farmer): how many of the farmer's soil (N, P, K, pH) and
weather (temperature, humidity, rainfall) values lie inside the crop's typical 5th-95th
percentile range in the training dataset.
"""
from __future__ import annotations

import json
from calendar import month_name
from datetime import date

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.common import paths
from app.ml.common.reference import (STATE, add_months, calendar, city_climate, economics, month_label,
                                     months_between)
from app.ml.crop_recommendation.features import FEATURES, build_features, collapse_shap
from app.ml.economics.profit import evaluate, planting_fit, timeline, timing_score
from app.ml.explainability.crop_explainer import explain_crop
from app.ml.price_prediction.monthly_forecaster import MonthlyForecastError

MONTH_NAMES = list(month_name)[1:]
WEIGHTS = {"location": 0.20, "planting": 0.20, "selling": 0.10, "soil": 0.15, "weather": 0.15, "profit": 0.20}
RELIABILITY_SHRINK = 0.75  # weight kept on (P - 50) when the price forecast is limited
POLICY_BAND = "31-60"   # the longest daily-price band: selling months are weeks to months away
MATERIAL_POINTS = 0.5  # weighted score difference below which a part is not named as a reason
MIN_RANGE_FIT = 5  # of 7 soil and weather values
TOP_N = 3


SOIL_FEATURES = ("N", "P", "K", "ph")
WEATHER_FEATURES = ("temperature", "humidity", "rainfall")


def range_fit(inputs: dict, ranges: dict) -> dict:
    """Which soil / weather inputs lie in the crop's typical (p05-p95) range."""
    def one(features):
        items = {f: bool(ranges[f]["p05"] <= inputs[f] <= ranges[f]["p95"]) for f in features}
        return {"within": sum(items.values()), "total": len(items), "items": items}
    return {"soil": one(SOIL_FEATURES), "weather": one(WEATHER_FEATURES)}


def forecast_reliability(market: dict | None) -> str:
    """tested = beat the simple baseline in testing; limited = did not, or beyond the model horizon."""
    f = market["forecast"] if market else None
    if not f:
        return "unavailable"
    return "limited" if f.get("beyond_model_horizon") or not f["reliability"]["beats_baseline"] else "tested"


def status_of(r: dict, best_overall: str | None) -> dict:
    """The single label of a crop in the comparison table. Order matters: the first match wins."""
    if not r["feasible"]:
        return {"key": "notFeasible", "tone": "bad"}
    if not r["planting_suitable"]:
        return {"key": "offSeason", "tone": "bad"}
    if r["crop_name"] == best_overall:
        return {"key": "best", "tone": "good"}
    if r["recommended"]:
        return {"key": "recommended", "tone": "good"}
    if not r["profitable"]:
        return {"key": "loss", "tone": "bad"}
    if r["low_agronomic_suitability"]:
        return {"key": "poorFit", "tone": "warn"}
    return {"key": "notTop", "tone": "neutral"}


def ranking_explanation(results: list[dict], best_overall: str | None, highest_profit: str | None) -> dict:
    """Why the best overall crop is (or is not) the one with the highest profit, from the real scores.
    Reasons are codes + numbers so the page can phrase them in the farmer's language."""
    by = {r["crop_name"]: r for r in results}
    out = {"best_overall": best_overall, "highest_profit": highest_profit,
           "same_crop": best_overall is not None and best_overall == highest_profit, "reasons": [],
           "profit_gap": None}
    if best_overall is None or highest_profit is None or out["same_crop"]:
        return out
    b, h = by[best_overall], by[highest_profit]
    out["profit_gap"] = round(h["economics"]["net_profit"] - b["economics"]["net_profit"], 0)
    pts = {k: sum(b["score_points"][c] - h["score_points"][c] for c in cs) for k, cs in
           (("agronomic", ("soil", "weather")), ("location", ("location",)), ("timing", ("planting", "selling")),
            ("profit", ("profit",)))}
    n = lambda r: r["range_fit"]["soil"]["within"] + r["range_fit"]["weather"]["within"]
    total = b["range_fit"]["soil"]["total"] + b["range_fit"]["weather"]["total"]
    reasons = out["reasons"]
    if pts["agronomic"] > MATERIAL_POINTS:
        reasons.append({"code": "fit", "points": round(pts["agronomic"], 1),
                        "params": {"best_in": n(b), "top_in": n(h), "total": total}})
    if pts["location"] > MATERIAL_POINTS:
        reasons.append({"code": "location", "points": round(pts["location"], 1), "params": {}})
    if pts["timing"] > MATERIAL_POINTS:
        reasons.append({"code": "timing", "points": round(pts["timing"], 1), "params": {}})
    if pts["profit"] > MATERIAL_POINTS:
        code = ("forecast" if b["forecast_reliability"] == "tested" and h["forecast_reliability"] != "tested"
                else "returns")
        reasons.append({"code": code, "points": round(pts["profit"], 1),
                        "params": {"best_roi": round(b["economics"]["roi_pct"]),
                                   "top_roi": round(h["economics"]["roi_pct"])}})
    reasons.sort(key=lambda x: -x["points"])
    return out


def planting_year_for(planting_month: int, today: date) -> int:
    """Next occurrence of the planting month (this month counts as 'now')."""
    return today.year if planting_month >= today.month else today.year + 1


class CropRecommender:
    def __init__(self, monthly_forecaster=None) -> None:
        d = paths.REC_MODEL_DIR
        self.meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        self.model = joblib.load(d / "crop_model.joblib")
        self.estimator = self.model.named_steps["model"]    # the XGBoost step of the pipeline
        self.estimator.set_params(n_jobs=1)    # single-row requests: thread start-up costs more
        # min/max of every numeric input in the training data (feature_ranges.json, written by training)
        self.input_ranges: dict[str, dict] = json.loads(
            paths.REC_FEATURE_RANGES_PATH.read_text(encoding="utf-8"))["numeric"]
        self.label_encoder = joblib.load(d / "label_encoder.joblib")
        self.features: list[str] = self.meta["features"]
        assert self.features == FEATURES, "model was trained with a different feature set"
        self.cities: list[str] = self.meta["cities"]
        self.classes: list[str] = list(self.label_encoder.classes_)
        self.ranges = self.meta["feature_ranges_by_crop"]
        self.explainer = shap.TreeExplainer(self.estimator)
        self.version = self.meta["version"]
        self.calendar = calendar()
        self.climate = city_climate()
        self.economics = economics()
        self.forecaster = monthly_forecaster
        # per crop x distance-band "model" / "context_only" of the daily price model (scripts/build_crop_policy.py); used here
        # only to LABEL a crop's profit as a rough estimate. It does not change any price or score.
        try:
            self.price_policy = json.loads((paths.MODELS_DIR / "price_reliability" / "crop_policy.json").read_text(encoding="utf-8"))["cells"]
        except (OSError, KeyError, ValueError):
            self.price_policy = {}

    # ------------------------------------------------------------------ model
    def _frame(self, inputs: dict) -> pd.DataFrame:
        return build_features(pd.DataFrame([inputs]), self.cities)

    def _shap(self, X: pd.DataFrame) -> np.ndarray:
        """SHAP values (features, classes) for one row, log-odds space."""
        Xt = self.model[:-1].transform(X)      # one-hot soil columns
        sv = np.asarray(self.explainer.shap_values(Xt))
        if sv.ndim == 3 and sv.shape[0] == len(self.classes) and sv.shape[1] == 1:
            sv = np.transpose(sv, (1, 2, 0))
        return collapse_shap(sv[0], list(Xt.columns))    # soil_type columns summed back into one feature

    def _base_values(self) -> np.ndarray:
        return np.atleast_1d(self.explainer.expected_value).astype(float)

    def _location(self, crop: str, city: str, planting_month: int, offset: int) -> dict:
        """Location score (0-100): growing-belt share + the city's own climate over the growing months vs the crop's usual ranges."""
        cal = self.calendar[crop]
        share = float(self.ranges[crop].get("_cities", {}).get(city, 0.0))
        belt = min(1.0, share * len(self.cities)) * 100.0
        n = max(1, min(offset, cal.growth_months_max))
        months = [(planting_month - 1 + k) % 12 + 1 for k in range(n)]
        rows = self.climate[(self.climate["city"] == city) & (self.climate["month"].isin(months))]
        cols = {"temperature": "temperature_c", "humidity": "humidity_pct", "rainfall": "rainfall_mm"}
        values = {f: float(rows[c].mean()) for f, c in cols.items()} if len(rows) else {}
        items = {f: bool(self.ranges[crop][f]["p05"] <= v <= self.ranges[crop][f]["p95"]) for f, v in values.items()}
        clim = 100.0 * sum(items.values()) / len(cols) if items else 0.0
        return {"score": round(0.5 * belt + 0.5 * clim, 2), "growing_area_share_pct": round(share * 100, 1),
                "growing_area_score": round(belt, 1), "climate_score": round(clim, 1),
                "climate": {"months": months, "values": {f: round(v, 1) for f, v in values.items()}, "items": items}}

    # ------------------------------------------------------------------ market + profit
    def _market(self, crop: str, city: str, py: int, pm: int, offset: int,
                area: float) -> dict:
        cal, econ = self.calendar[crop], self.economics[crop]
        sy, sm = add_months(py, pm, offset)
        last_feasible = cal.growth_months_max + cal.max_storage_months
        extra = max(0, last_feasible - offset)
        f = self.forecaster.forecast_path(crop, city, sy, sm, extra_months=extra, explain=True)
        by_month = {p["month"]: p for p in f["path"]}
        inflation = self.forecaster.inflation

        econ_out = evaluate(econ, cal, price=f["predicted_price"], price_low=f["price_low"],
                            price_high=f["price_high"], offset=offset, planting_year=py,
                            area_acres=area, inflation=inflation)
        options = []
        for k in range(cal.growth_months_min, last_feasible + 1):
            p = by_month.get(month_label(*add_months(py, pm, k)))
            if p is None:
                continue
            e = evaluate(econ, cal, price=p["price"], price_low=p["low"], price_high=p["high"],
                         offset=k, planting_year=py, area_acres=area, inflation=inflation)
            options.append({"offset": k, "month": p["month"], "price": p["price"],
                            "net_profit": e["net_profit"], "status": e["status"]})
        best = max(options, key=lambda o: o["net_profit"]) if options else None
        # the chart shows the path up to the selling month or the best month, whichever is later
        cut = max(f["horizon_months"],
                  next((p["horizon"] for p in f["path"] if best and p["month"] == best["month"]), 0))
        f["path"] = f["path"][:cut]
        return {"forecast": f, "economics": econ_out, "selling_options": options,
                "timeline": timeline(cal, py, pm, offset, best and best["offset"],
                                     best and best["net_profit"])}

    # ------------------------------------------------------------------ main
    def analyze(self, inputs: dict, city: str, planting_month: int, selling_month: int,
                area_acres: float = 1.0, today: date | None = None,
                planting_year: int | None = None) -> dict:
        """``inputs``: N, P, K, temperature, humidity, ph, rainfall."""
        if city not in self.cities:
            raise ValueError(f"Unsupported city '{city}'")
        today = today or date.today()
        py = planting_year or planting_year_for(planting_month, today)
        offset = months_between(planting_month, selling_month)
        sy, sm = add_months(py, planting_month, offset)
        row = {**inputs, "city": city, "planting_month": planting_month,
               "selling_month": selling_month}
        X = self._frame(row)
        proba = self.model.predict_proba(X)[0]
        sv = self._shap(X)
        ctx = {**row, "growing_months": offset}

        results = []
        for i, crop in enumerate(self.classes):
            cal = self.calendar[crop]
            fit = range_fit(inputs, self.ranges[crop])
            n_in = fit["soil"]["within"] + fit["weather"]["within"]
            n_all = fit["soil"]["total"] + fit["weather"]["total"]
            a = 100.0 * n_in / n_all
            soil_s = 100.0 * fit["soil"]["within"] / fit["soil"]["total"]
            weather_s = 100.0 * fit["weather"]["within"] / fit["weather"]["total"]
            t, status, stored = timing_score(cal, planting_month, offset)
            plant_fit = planting_fit(cal, planting_month)
            sell_fit = 2 * t - plant_fit    # T = 0.5 planting fit + 0.5 selling fit
            shap_map = dict(zip(self.features, map(float, sv[:, i])))
            exp = explain_crop(crop, shap_map, ctx, self.ranges[crop], cal)
            try:
                market = self._market(crop, city, py, planting_month, offset, area_acres)
            except MonthlyForecastError as err:
                market = {"forecast": None, "economics": None, "selling_options": [],
                          "timeline": timeline(cal, py, planting_month, offset, None, None),
                          "error": str(err)}
            econ = market["economics"]
            p_score = econ["profit_score"] if econ else 0.0
            reliability = forecast_reliability(market)
            p_used = (50 + RELIABILITY_SHRINK * (p_score - 50)
                      if econ and p_score and reliability == "limited" else p_score)
            loc = self._location(crop, city, planting_month, offset)
            parts = {"location": WEIGHTS["location"] * loc["score"], "planting": WEIGHTS["planting"] * plant_fit,
                     "selling": WEIGHTS["selling"] * sell_fit, "soil": WEIGHTS["soil"] * soil_s,
                     "weather": WEIGHTS["weather"] * weather_s, "profit": WEIGHTS["profit"] * p_used}
            overall = sum(parts.values())
            feasible = econ["feasible"] if econ else status in ("fresh", "stored")
            profitable = bool(econ and econ["net_profit"] > 0)
            viable = n_in >= MIN_RANGE_FIT
            planting_ok = plant_fit > 0     # a documented or adjacent planting month in the crop calendar
            eligible = bool(planting_ok and viable and feasible and profitable)
            results.append({
                "crop_name": crop, "probability": float(proba[i]),
                "model_match_score": round(float(proba[i] * 100), 2),
                "agronomic_score": round(a, 2), "timing_score": round(t, 1),
                "planting_fit_score": round(plant_fit, 1), "selling_fit_score": round(sell_fit, 1),
                "profit_score": p_score, "profit_score_used": round(p_used, 1),
                "forecast_reliability": reliability, "recommendation_score": round(overall, 2),
                "location_score": loc["score"], "location": loc, "soil_score": round(soil_s, 1),
                "weather_score": round(weather_s, 1), "planting_suitable": bool(planting_ok),
                "_parts": parts,
                "price_policy": self.price_policy.get(f"{crop}|{POLICY_BAND}", {}).get("mode", "model"),
                "seasonal_score": float(100 if planting_month in cal.planting_months else 0),
                "price_score": market["forecast"]["price_score"] if market["forecast"] else None,
                "eligible": eligible, "profitable": profitable,
                "feasible": bool(feasible),
                "range_fit": fit,
                "forecast_reliable": (market["forecast"]["reliability"]["beats_baseline"]
                                      if market["forecast"] else None),
                "low_agronomic_suitability": not viable,
                "summary": exp["summary"], "reasons": exp["reasons"],
                "limitations": self._limitations(crop, exp, status, stored, offset, econ,
                                                 market, proba[i], not viable, plant_fit),
                "important_factors": exp["factors"], "factor_groups": exp["groups"],
                "shap_base_value": float(self._base_values()[i]),
                "economics": econ, "timeline": market["timeline"],
                "selling_options": market["selling_options"],
                "market": market["forecast"],
                "why": self._why(crop, exp, market, econ),
            })

        results.sort(key=lambda r: (r["eligible"], r["recommendation_score"]), reverse=True)
        for rank, r in enumerate(results, start=1):
            r["rank"] = rank
            r["recommended"] = r["eligible"] and rank <= TOP_N
        priced = sorted((r for r in results if r["feasible"] and r["economics"]),
                        key=lambda r: r["economics"]["net_profit"], reverse=True)
        for r in results:
            sp = {k: round(v, 2) for k, v in r.pop("_parts").items()}
            r["score_points"] = {**sp, "agronomic": round(sp["soil"] + sp["weather"], 2),
                                 "timing": round(sp["planting"] + sp["selling"], 2)}
        for k, r in enumerate(priced, start=1):
            r["profit_rank"] = k
        for r in results:
            r.setdefault("profit_rank", None)
        best_overall = next((r["crop_name"] for r in results if r["recommended"]), None)
        highest_profit = priced[0]["crop_name"] if priced and priced[0]["economics"]["net_profit"] > 0 else None
        for r in results:
            r["status"] = status_of(r, best_overall)
        return {
            "generated_at": today.isoformat(),
            "best_overall": best_overall, "highest_profit": highest_profit,
            "ranking_explanation": ranking_explanation(results, best_overall, highest_profit),
            "state": STATE, "city": city, "planting_month": planting_month,
            "selling_month": selling_month, "planting_date": month_label(py, planting_month),
            "selling_date": month_label(sy, sm), "growing_months": offset,
            "area_acres": area_acres, "results": results, "weights": WEIGHTS,
            "model": {"crop": {"version": self.version, "algorithm": self.meta["selected_model"],
                               "test_metrics": self.meta["test_metrics"]},
                      "price": {"version": self.forecaster.version,
                                "algorithm": self.forecaster.meta["algorithm"],
                                "data_end": self.forecaster.meta["data_end"],
                                "inflation_annual_pct": self.forecaster.inflation * 100}},
            "notes": [
                "Suitability comes from an XGBoost model trained on a synthetic Maharashtra "
                "dataset generated from agronomic reference ranges (see DATASET.md).",
                "Prices come from an XGBoost model trained on 2023–2025 Maharashtra mandi "
                "prices; months after the data end are projections.",
                "Yields and costs per acre are approximate reference figures — replace them "
                "with your own numbers for a precise budget.",
            ],
        }

    def _limitations(self, crop, exp, status, stored, offset, econ, market, p,
                     low: bool, plant_fit: float) -> list[str]:
        out = list(exp["limitations"])
        cal = self.calendar[crop]
        if low:
            out.insert(0, f"Low suitability: the model gives {crop} only a {p * 100:.0f}% match "
                          "for your soil, weather and timing.")
        if plant_fit == 0:
            out.insert(0, f"{crop} is not usually planted in this month; documented planting months are "
                          f"{', '.join(MONTH_NAMES[m - 1] for m in sorted(cal.planting_months))}.")
        if status == "not_ready":
            out.insert(0, f"{crop} needs {cal.growth_months_min}–{cal.growth_months_max} months; "
                          f"it will not be ready {offset} months after planting.")
        elif status == "spoiled":
            out.insert(0, f"{crop} cannot be held {stored} months after harvest "
                          f"({'max ' + str(cal.max_storage_months) + ' months storage' if cal.storable else 'perishable'}).")
        elif status == "stored":
            out.append(f"Selling in this month means storing the harvest about {stored} "
                       "month(s) — storage costs and losses are included.")
        if econ and econ["net_profit"] < 0:
            out.append(f"Expected loss at the forecast price (break-even ≈ ₹{econ['break_even_price']:,.0f}/quintal).")
        if market.get("error"):
            out.append(market["error"])
        elif market["forecast"] and not market["forecast"]["reliability"]["beats_baseline"]:
            out.append("The price model was not more accurate than a simple 'latest price + "
                       f"inflation' estimate for {crop} in testing — price is indicative.")
        return out

    @staticmethod
    def _why(crop: str, exp: dict, market: dict, econ: dict | None) -> list[dict]:
        """'Why this recommendation?' — three plain-language pillars backed by SHAP."""
        groups = {g["group"]: g for g in exp["groups"]}
        pillars = []
        for key, title in (("weather", "Weather compatibility"), ("soil", "Soil health")):
            g = groups.get(key)
            if g:
                pillars.append({"key": key, "title": title, "direction": g["direction"],
                                "share_pct": g["share_pct"], "points": g["points"]})
        timing_pts = [p for k in ("timing", "location") if k in groups for p in groups[k]["points"]]
        t_val = sum(groups[k]["share_pct"] for k in ("timing", "location") if k in groups)
        pillars.append({"key": "timing", "title": "Timing & location",
                        "direction": "supports" if t_val > 0 else "against",
                        "share_pct": round(t_val, 1), "points": timing_pts[:3]})
        f = market.get("forecast")
        if f:
            pts = [f["explanation"]["headline"]]
            pts += [f"{x['label']}: {x['text']}" for x in f["explanation"]["factors"][:2]]
            if econ:
                pts.append(f"Expected net profit ₹{econ['net_profit']:,.0f} for "
                           f"{econ['area_acres']:g} acre(s) (ROI {econ['roi_pct']:+.0f}%), "
                           f"break-even price ₹{econ['break_even_price']:,.0f}/quintal.")
            pillars.append({"key": "market", "title": "Market demand & profit",
                            "direction": "supports" if econ and econ["net_profit"] > 0 else "against",
                            "share_pct": None, "points": pts})
        return pillars

    def explain(self, inputs: dict, city: str, planting_month: int, selling_month: int,
                crop: str) -> dict:
        if crop not in self.classes:
            raise ValueError(f"Unsupported crop '{crop}'")
        row = {**inputs, "city": city, "planting_month": planting_month,
               "selling_month": selling_month}
        X = self._frame(row)
        i = self.classes.index(crop)
        sv = self._shap(X)
        margin = float(self.estimator.predict(self.model[:-1].transform(X), output_margin=True)[0][i])
        exp = explain_crop(crop, dict(zip(self.features, map(float, sv[:, i]))),
                           {**row, "growing_months": months_between(planting_month, selling_month)},
                           self.ranges[crop], self.calendar[crop])
        return {"crop": crop, "probability": float(self.model.predict_proba(X)[0][i]),
                "base_value": float(self._base_values()[i]), "margin": margin,
                "method": "SHAP TreeExplainer on the XGBoost classifier (log-odds per crop)",
                **exp}
