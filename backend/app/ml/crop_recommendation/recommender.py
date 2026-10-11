"""Smart economic crop recommendation for the 7 supported crops.

Scores (each 0-100)
-------------------
Agronomic  A = XGBoost classifier probability x 100 (soil, weather, city, planting month,
               selling month).
Timing     T = 50 % planting-window fit (100 in a documented planting month, 50 one month
               off, else 0) + 50 % selling fit (100 if the crop is freshly harvested in the
               selling month, minus 12 per month of storage for storable crops, 0 if it would
               not be ready yet or would have spoiled).
Profit     P = 50 + 50 tanh(ROI) from the profitability engine, using the XGBoost monthly
               price forecast for the selling month in the user's city (0 if infeasible).

Overall    = 0.40 A + 0.20 T + 0.40 P

Why these weights: there is no labelled ground truth for "best crop to plant", so weights
cannot be learned. Suitability and profit share most of the weight equally — a crop that
cannot grow is never a good choice, and the farmer asked for financial returns — while
timing is a feasibility check. scripts/score_sensitivity.py reports how rankings change.

Eligibility: a crop is recommended only if its suitability probability is at least
MIN_PROBABILITY and it can actually be sold in the chosen month. All 7 crops are still
returned (ranked, flagged) so the comparison chart shows every option.
"""
from __future__ import annotations

import json
from datetime import date

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.common import paths
from app.ml.common.reference import (STATE, add_months, calendar, economics, month_label,
                                     months_between)
from app.ml.crop_recommendation.features import FEATURES, build_features
from app.ml.economics.profit import evaluate, timeline, timing_score
from app.ml.explainability.crop_explainer import explain_crop
from app.ml.price_prediction.monthly_forecaster import MonthlyForecastError

WEIGHTS = {"agronomic": 0.40, "timing": 0.20, "profit": 0.40}
MIN_PROBABILITY = 0.05
TOP_N = 3


def planting_year_for(planting_month: int, today: date) -> int:
    """Next occurrence of the planting month (this month counts as 'now')."""
    return today.year if planting_month >= today.month else today.year + 1


class CropRecommender:
    def __init__(self, monthly_forecaster=None) -> None:
        d = paths.REC_MODEL_DIR
        self.meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
        self.model = joblib.load(d / "crop_model.joblib")
        if hasattr(self.model, "n_jobs"):  # single-row requests: thread start-up costs more
            self.model.set_params(n_jobs=1)
        self.label_encoder = joblib.load(d / "label_encoder.joblib")
        self.features: list[str] = self.meta["features"]
        assert self.features == FEATURES, "model was trained with a different feature set"
        self.cities: list[str] = self.meta["cities"]
        self.classes: list[str] = list(self.label_encoder.classes_)
        self.ranges = self.meta["feature_ranges_by_crop"]
        self.explainer = shap.TreeExplainer(self.model)
        self.version = self.meta["version"]
        self.calendar = calendar()
        self.economics = economics()
        self.forecaster = monthly_forecaster

    # ------------------------------------------------------------------ model
    def _frame(self, inputs: dict) -> pd.DataFrame:
        return build_features(pd.DataFrame([inputs]), self.cities)

    def _shap(self, X: pd.DataFrame) -> np.ndarray:
        """SHAP values (features, classes) for one row, log-odds space."""
        sv = np.asarray(self.explainer.shap_values(X))
        if sv.ndim == 3 and sv.shape[0] == len(self.classes) and sv.shape[1] == 1:
            sv = np.transpose(sv, (1, 2, 0))
        return sv[0]

    def _base_values(self) -> np.ndarray:
        return np.atleast_1d(self.explainer.expected_value).astype(float)

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
            a = float(proba[i] * 100)
            t, status, stored = timing_score(cal, planting_month, offset)
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
            overall = (WEIGHTS["agronomic"] * a + WEIGHTS["timing"] * t
                       + WEIGHTS["profit"] * p_score)
            feasible = econ["feasible"] if econ else status in ("fresh", "stored")
            results.append({
                "crop_name": crop, "probability": float(proba[i]),
                "agronomic_score": round(a, 2), "timing_score": round(t, 1),
                "profit_score": p_score, "recommendation_score": round(overall, 2),
                "seasonal_score": float(100 if planting_month in cal.planting_months else 0),
                "price_score": market["forecast"]["price_score"] if market["forecast"] else None,
                "eligible": bool(proba[i] >= MIN_PROBABILITY and feasible),
                "feasible": bool(feasible),
                "low_agronomic_suitability": bool(proba[i] < MIN_PROBABILITY),
                "summary": exp["summary"], "reasons": exp["reasons"],
                "limitations": self._limitations(crop, exp, status, stored, offset, econ,
                                                 market, proba[i]),
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
        return {
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

    def _limitations(self, crop, exp, status, stored, offset, econ, market, p) -> list[str]:
        out = list(exp["limitations"])
        cal = self.calendar[crop]
        if p < MIN_PROBABILITY:
            out.insert(0, f"Low suitability: the model gives {crop} only a {p * 100:.0f}% match "
                          "for your soil, weather and timing.")
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
        margin = float(self.model.predict(X, output_margin=True)[0][i])
        exp = explain_crop(crop, dict(zip(self.features, map(float, sv[:, i]))),
                           {**row, "growing_months": months_between(planting_month, selling_month)},
                           self.ranges[crop], self.calendar[crop])
        return {"crop": crop, "probability": float(self.model.predict_proba(X)[0][i]),
                "base_value": float(self._base_values()[i]), "margin": margin,
                "method": "SHAP TreeExplainer on the XGBoost classifier (log-odds per crop)",
                **exp}
