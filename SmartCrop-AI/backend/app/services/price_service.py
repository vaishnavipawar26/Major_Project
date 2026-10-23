from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.ml.price_prediction.forecaster import ForecastError, PriceForecaster, SeriesRef
from app.models.price_prediction import PricePrediction
from app.models.user import User
from app.schemas.price_prediction import PriceRequest
from app.services.model_version_service import get_or_create_model_version

PATH_KEYS = ("horizon_days", "date", "predicted_price", "lower", "upper", "change_pct",
             "direction", "beats_baseline")


def today() -> date:
    """Forecast start date for new predictions (a function so tests can fix 'today')."""
    return date.today()


def options(forecaster: PriceForecaster) -> dict:
    return {**forecaster.options(), "today": today().isoformat()}


def _run(forecaster: PriceForecaster, req: PriceRequest, as_of: date, explain: bool) -> dict:
    try:
        variety = req.variety or forecaster.default_variety(req.state, req.market, req.commodity)
        ref = SeriesRef(req.state, req.market, req.commodity, variety)
        return forecaster.forecast(ref, as_of, req.target_date, explain=explain)
    except ForecastError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _forecast_fields(f: dict) -> dict:
    return {k: f[k] for k in ("series", "input_date", "forecast_origin_date", "target_date",
                              "target_horizon_days", "current_price", "arrivals_used", "target",
                              "path", "last_validated_days", "validated_days",
                              "max_horizon_days", "advice", "policy", "range_info", "latest_recorded", "history", "history_is_reference",
                              "actual_after_origin", "model", "projection", "source", "dates",
                              "disclaimer")}


def predict(db: Session, user: User, forecaster: PriceForecaster, req: PriceRequest) -> dict:
    """New prediction: always starts from today, whatever ``as_of`` the client sent."""
    start = today()
    f = _run(forecaster, req, start, explain=False)
    t = f["target"]

    meta = forecaster.meta
    sel = meta["selected"]
    mv = get_or_create_model_version(
        db, "price_prediction", forecaster.version,
        f"{', '.join(sorted(meta['model_files']))} (daily, 1-{meta['max_horizon']} days)"[:100],
        {"all": sel["cv_mean"]["all"], "horizon_models": sel["model"]}, meta.get("trained_at"))

    row = PricePrediction(
        user_id=user.id, model_version_id=mv.id if mv else None,
        # the market the farmer chose, even when another source was used (re-opening repeats the choice)
        state=req.state, market=f["source"]["requested_market"],
        commodity=f["series"]["commodity"], variety=f["source"]["requested_variety"],
        input_date=start, forecast_origin_date=date.fromisoformat(f["forecast_origin_date"]),
        arrivals=f["arrivals_used"],
        # days from the forecast start to the target date, so the target can be rebuilt
        horizon_days=(req.target_date - start).days,
        current_price=f["current_price"], predicted_price=t["predicted_price"],
        predicted_low=t["lower"], predicted_high=t["upper"], predicted_direction=t["direction"],
        future_trend=[{k: p[k] for k in PATH_KEYS} for p in f["path"]],
        sell_hold_suggestion=f["advice"]["label"][:60],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, **_forecast_fields(f)}


def trend(forecaster: PriceForecaster, req: PriceRequest) -> dict:
    return _forecast_fields(_run(forecaster, req, req.as_of or today(), explain=False))


def explain(forecaster: PriceForecaster, req: PriceRequest) -> dict:
    f = _run(forecaster, req, req.as_of or today(), explain=True)
    return {"series": f["series"], "forecast_origin_date": f["forecast_origin_date"],
            "target_date": f["target_date"], "current_price": f["current_price"],
            "projection": f["projection"], "model": f["model"], "explanations": f["explanations"],
            "source": f.get("source"),
            "message": None if f["explanations"] else
            "The model could not calculate an explanation for this forecast."}
