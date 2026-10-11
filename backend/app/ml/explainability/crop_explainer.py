"""Farmer-friendly explanations for the crop classifier's SHAP values.

The XGBoost classifier's SHAP values are in log-odds (margin) space for each crop. For display
each value is also given as a signed share of the total absolute SHAP ("share of the model's
reasoning"), which needs no knowledge of log-odds.

Comparison ranges ("typical range for onion") are the 5th-95th percentiles of that crop's rows
in the (synthetic) training dataset — a statement about the data, not agronomic advice.
"""
from __future__ import annotations

from app.ml.common.reference import CropCalendar
from app.ml.crop_recommendation.features import FEATURE_GROUPS, GROUP_LABELS

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
FEATURE_LABELS = {
    "N": ("Nitrogen (N)", ""), "P": ("Phosphorus (P)", ""), "K": ("Potassium (K)", ""),
    "temperature": ("Temperature", " °C"), "humidity": ("Humidity", " %"),
    "ph": ("Soil pH", ""), "rainfall": ("Rainfall", " mm"),
    "city_code": ("City", ""), "planting_month": ("Planting month", ""),
    "selling_month": ("Selling month", ""), "growing_months": ("Months to selling", ""),
}
PHRASES = {"N": "nitrogen level", "P": "phosphorus level", "K": "potassium level",
           "temperature": "temperature", "humidity": "humidity", "ph": "soil pH",
           "rainfall": "rainfall"}


def _fmt(v: float) -> str:
    return f"{v:.1f}" if abs(v) < 100 else f"{v:.0f}"


def _display_value(f: str, inputs: dict) -> str:
    if f == "city_code":
        return inputs["city"]
    if f in ("planting_month", "selling_month"):
        return MONTHS[int(inputs[f]) - 1]
    if f == "growing_months":
        return f"{int(inputs[f])} months"
    return f"{_fmt(inputs[f])}{FEATURE_LABELS[f][1]}"


def _sentence(f: str, crop: str, s: float, inputs: dict, ranges: dict, cal: CropCalendar) -> str:
    sup = s > 0
    if f in PHRASES:
        r = ranges[f]
        rng = f"{_fmt(r['p05'])}–{_fmt(r['p95'])}{FEATURE_LABELS[f][1]}"
        within = r["p05"] <= inputs[f] <= r["p95"]
        val = _display_value(f, inputs)
        if sup:
            return (f"Your {PHRASES[f]} ({val}) is {'optimal' if within else 'acceptable'} for "
                    f"{crop} (typical {rng}).")
        return (f"Your {PHRASES[f]} ({val}) is {'within' if within else 'outside'} the typical "
                f"{crop} range ({rng}) but counts against it compared with other crops.")
    if f == "city_code":
        share = ranges.get("_cities", {}).get(inputs["city"], 0) * 100
        return (f"{inputs['city']} is {'a common' if share >= 10 else 'a less common'} growing area "
                f"for {crop} ({share:.0f}% of {crop} records).")
    if f == "planting_month":
        m = MONTHS[int(inputs[f]) - 1]
        ok = int(inputs[f]) in cal.planting_months
        return f"{m} is {'a documented' if ok else 'not a usual'} planting month for {crop}."
    if f == "selling_month":
        return f"Selling in {MONTHS[int(inputs[f]) - 1]} {'fits' if sup else 'fits poorly with'} {crop}'s usual harvest/sale period."
    if f == "growing_months":
        n = int(inputs[f])
        lo, hi = cal.growth_months_min, cal.growth_months_max
        extra = f" (+ up to {cal.max_storage_months} months storage)" if cal.max_storage_months else ""
        return (f"{n} months from planting to selling {'matches' if sup else 'does not match'} "
                f"{crop}'s {lo}–{hi}-month crop cycle{extra}.")
    return ""


def explain_crop(crop: str, shap_values: dict[str, float], inputs: dict, ranges: dict,
                 cal: CropCalendar, top_k: int = 3) -> dict:
    total = sum(abs(v) for v in shap_values.values()) or 1.0
    factors = []
    for f, s in sorted(shap_values.items(), key=lambda kv: abs(kv[1]), reverse=True):
        r = ranges.get(f)
        factors.append({
            "feature": f, "label": FEATURE_LABELS[f][0], "group": FEATURE_GROUPS[f],
            "group_label": GROUP_LABELS[FEATURE_GROUPS[f]],
            "value": _display_value(f, inputs), "shap_value": round(float(s), 5),
            "share_pct": round(float(s) / total * 100, 1),
            "direction": "supports" if s > 0 else "against",
            "typical_low": round(r["p05"], 2) if r else None,
            "typical_high": round(r["p95"], 2) if r else None,
            "within_typical_range": (r["p05"] <= inputs[f] <= r["p95"]) if r else None,
            "unit": FEATURE_LABELS[f][1].strip(),
            "text": _sentence(f, crop, s, inputs, ranges, cal),
        })

    groups = {}
    for fa in factors:
        g = groups.setdefault(fa["group"], {"group": fa["group"], "label": fa["group_label"],
                                            "shap_value": 0.0, "points": []})
        g["shap_value"] += fa["shap_value"]
        g["points"].append(fa["text"])
    for g in groups.values():
        g["shap_value"] = round(g["shap_value"], 5)
        g["share_pct"] = round(g["shap_value"] / total * 100, 1)
        g["direction"] = "supports" if g["shap_value"] > 0 else "against"
        g["points"] = g["points"][:3]

    reasons = [f["text"] for f in factors if f["direction"] == "supports"][:top_k]
    limitations = [f["text"] for f in factors if f["direction"] == "against"
                   and abs(f["share_pct"]) >= 8][:2]
    top = [GROUP_LABELS[f["group"]].lower() for f in factors if f["direction"] == "supports"]
    top = list(dict.fromkeys(top))[:2]
    summary = (f"{crop} suits your field mainly because of {' and '.join(top)}." if top else
               f"Your soil and weather values are not a strong match for {crop}.")
    return {"summary": summary, "reasons": reasons, "limitations": limitations,
            "factors": factors,
            "groups": sorted(groups.values(), key=lambda g: abs(g["shap_value"]), reverse=True)}
