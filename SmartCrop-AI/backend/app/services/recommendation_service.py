from dataclasses import asdict

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.ml.common.reference import STATE
from app.ml.common.seasons import season_for_month
from app.ml.crop_recommendation.recommender import CropRecommender
from app.models.crop_recommendation import CropRecommendation, RecommendationResult
from app.models.user import User
from app.schemas.crop_recommendation import CropExplainRequest, CropRequest, SoilWeatherInputs
from app.services.model_version_service import get_or_create_model_version

FEATURE_NAMES = {"N": "nitrogen", "P": "phosphorus", "K": "potassium",
                 "temperature": "temperature", "humidity": "humidity", "ph": "pH",
                 "rainfall": "rainfall"}


def range_warnings(rec: CropRecommender, body: SoilWeatherInputs) -> list[str]:
    """Inputs outside the training data range mean the model is extrapolating."""
    summary = rec.meta["data_quality"]["feature_summary"]
    out = []
    for f, v in body.model_inputs().items():
        lo, hi = summary[f]["min"], summary[f]["max"]
        if not lo <= v <= hi:
            out.append(f"Your {FEATURE_NAMES[f]} value ({v:g}) is outside the range in the "
                       f"training data ({lo:g}–{hi:g}); the result is less reliable.")
    return out


def _check_city(rec: CropRecommender, city: str) -> str:
    match = {c.lower(): c for c in rec.cities}.get(city.lower())
    if match is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"'{city}' is not a supported city. Supported: {', '.join(rec.cities)}")
    return match


def analyze(rec: CropRecommender, body: CropRequest) -> dict:
    city = _check_city(rec, body.city)
    out = rec.analyze(body.model_inputs(), city=city, planting_month=body.planting_month,
                      selling_month=body.selling_month, area_acres=body.area_acres,
                      planting_year=body.planting_year)
    warnings = range_warnings(rec, body)
    if body.soil_type:
        warnings.append("Soil type was saved with your request but is not used by the model "
                        "(the training dataset has no soil-type column).")
    if not any(r["recommended"] for r in out["results"]):
        warnings.append("No crop is a good match for your field, sellable in the chosen month "
                        "and expected to make a profit. Try a different selling month or "
                        "check your inputs.")
    return {**out, "season_used": season_for_month(body.planting_month), "warnings": warnings}


def recommend(db: Session, user: User, rec: CropRecommender, body: CropRequest) -> dict:
    out = analyze(rec, body)
    mv = get_or_create_model_version(db, "crop_recommendation", rec.version,
                                     rec.meta["selected_model"], rec.meta["test_metrics"],
                                     rec.meta.get("trained_at"))
    row = CropRecommendation(
        user_id=user.id, model_version_id=mv.id if mv else None,
        nitrogen=body.nitrogen, phosphorus=body.phosphorus, potassium=body.potassium,
        temperature=body.temperature, humidity=body.humidity, ph=body.ph,
        rainfall=body.rainfall, soil_type=body.soil_type, month=body.planting_month,
        season=out["season_used"], state=STATE, city=out["city"],
        selling_month=body.selling_month, planting_date=out["planting_date"],
        selling_date=out["selling_date"], area_acres=body.area_acres,
    )
    for r in out["results"]:
        e, m = r["economics"], r["market"]
        row.results.append(RecommendationResult(
            rank=r["rank"], crop_name=r["crop_name"],
            recommendation_score=r["recommendation_score"], agronomic_score=r["agronomic_score"],
            seasonal_score=r["seasonal_score"], price_score=r["price_score"],
            price_available=m is not None,
            predicted_price=e["selling_price"] if e else None,
            expected_price_trend=m["trend"] if m else None,
            timing_score=r["timing_score"], profit_score=r["profit_score"],
            expected_revenue=e["gross_revenue"] if e else None,
            expected_cost=e["total_cost"] if e else None,
            expected_profit=e["net_profit"] if e else None,
            recommended=r["recommended"],
            explanation={"summary": r["summary"], "reasons": r["reasons"],
                         "limitations": r["limitations"]},
        ))
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, **out}


def explain(rec: CropRecommender, body: CropExplainRequest) -> dict:
    crop = {c.lower(): c for c in rec.classes}.get(body.crop_name.strip().lower())
    if crop is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"'{body.crop_name}' is not a supported crop. "
                            f"Supported: {', '.join(rec.classes)}")
    city = _check_city(rec, body.city)
    return rec.explain(body.model_inputs(), city, body.planting_month, body.selling_month, crop)


def options(rec: CropRecommender) -> dict:
    summary = rec.meta["data_quality"]["feature_summary"]
    return {"state": STATE, "crops": rec.classes, "cities": rec.cities,
            "calendar": {k: asdict(v) for k, v in rec.calendar.items()},
            "economics": {k: asdict(v) for k, v in rec.economics.items()},
            "input_ranges": {f: [summary[f]["min"], summary[f]["max"]] for f in summary},
            "price_data_end": rec.forecaster.meta["data_end"],
            "inflation_annual_pct": rec.forecaster.inflation * 100}


def feature_ranges(rec: CropRecommender) -> dict:
    """Single source of truth for the form's ranges, all read from the trained model's metadata:
    min/max = the dataset's overall minimum/maximum (hard limits), perCrop = each crop's 5th-95th
    percentile (the same numbers behind "usual range" on the result page)."""
    summary = rec.meta["data_quality"]["feature_summary"]
    return {f: {"min": summary[f]["min"], "max": summary[f]["max"],
                "perCrop": {crop: [r[f]["p05"], r[f]["p95"]] for crop, r in rec.ranges.items()}}
            for f in summary}
