import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Direction = Literal["Increasing", "Decreasing", "Stable"]


class PriceRequest(BaseModel):
    state: str = Field(default="Maharashtra", min_length=2, max_length=100)
    market: str = Field(min_length=2, max_length=150)
    commodity: str = Field(min_length=2, max_length=100)
    variety: str | None = Field(default=None, max_length=100,
                                description="Optional; the market's main series is used if omitted")
    target_date: dt.date = Field(description="Date the farmer plans to sell")
    as_of: dt.date | None = Field(default=None, description=(
        "Forecast start date. /predict always uses today; /trend and /explain accept an "
        "earlier date to re-open a saved prediction. Defaults to today."))

    @field_validator("state", "market", "commodity", "variety")
    @classmethod
    def strip(cls, v: str | None) -> str | None:
        return None if v is None else " ".join(v.split())


class ForecastPoint(BaseModel):
    horizon_days: int
    date: dt.date
    predicted_price: float
    lower: float
    upper: float
    change_pct: float
    stable_band_pct: float
    direction: Direction
    actual_price: float | None = None
    beats_baseline: bool
    model_mae: float
    baseline_mae: float


class PeakInfo(BaseModel):
    date: dt.date
    horizon_days: int
    price: float
    reliable: bool
    diff_vs_target: float
    diff_pct: float


class StorageInfo(BaseModel):
    crop: str
    category: str
    max_hold_days: int
    note: str


class SellingAdvice(BaseModel):
    code: Literal["WAIT", "SELL_EARLIER", "SELL_ON_TARGET", "NO_CLEAR_DIFFERENCE", "UNCERTAIN"]
    label: str
    recommended_date: dt.date
    recommended_horizon_days: int
    recommended_price: float
    recommended_low: float
    recommended_high: float
    target_date: dt.date
    target_price: float
    target_low: float
    target_high: float
    extra_per_quintal: float
    extra_pct: float
    wait_days: int
    typical_error_pct: float
    explanation: str
    falls_after_target: bool
    peak: PeakInfo
    storage: StorageInfo
    considerations: list[str]
    disclaimer: str


class PricePoint(BaseModel):
    date: dt.date
    price: float


class SeriesInfo(BaseModel):
    state: str
    market: str
    commodity: str
    variety: str


class ModelInfo(BaseModel):
    version: str
    algorithm: str
    approach: str
    data_end: dt.date


class ProjectionInfo(BaseModel):
    """Present when the requested date is after the dataset: features were taken from the
    same calendar day ``years_ahead`` years earlier and prices scaled by inflation."""
    reference_origin_date: dt.date
    reference_price: float
    years_ahead: int
    inflation_annual_pct: float
    price_level_factor: float


class PriceForecastResponse(BaseModel):
    series: SeriesInfo
    input_date: dt.date
    forecast_origin_date: dt.date
    target_date: dt.date
    target_horizon_days: int
    current_price: float
    arrivals_used: float | None
    target: ForecastPoint
    path: list[ForecastPoint]
    last_validated_days: int
    validated_days: int
    max_horizon_days: int
    advice: SellingAdvice
    history: list[PricePoint]
    history_is_reference: bool
    actual_after_origin: list[PricePoint]
    model: ModelInfo
    projection: ProjectionInfo | None = None
    disclaimer: str


class PricePredictionResponse(PriceForecastResponse):
    id: int


class PriceFactor(BaseModel):
    factor: str
    title: str
    shap_value: float
    effect_pct: float
    direction: Literal["up", "down"]
    impact: Literal["higher", "lower", "small"]
    observation: str


class TechnicalFeature(BaseModel):
    feature: str
    label: str
    value: float | None
    shap_value: float


class PriceExplanation(BaseModel):
    horizon_days: int
    date: dt.date
    method: str
    output_space: str
    base_value: float
    base_change_pct: float
    prediction_change_pct: float
    all_small: bool
    farmer_explanation: list[str]
    factors: list[PriceFactor]
    technical: list[TechnicalFeature]


class PriceExplainResponse(BaseModel):
    series: SeriesInfo
    forecast_origin_date: dt.date
    target_date: dt.date
    current_price: float
    projection: ProjectionInfo | None = None
    explanations: list[PriceExplanation]
    message: str | None = None


class MarketOption(BaseModel):
    market: str
    is_state_aggregate: bool
    varieties: list[str]
    default_variety: str
    first_date: dt.date
    last_date: dt.date


class CommodityOption(BaseModel):
    commodity: str
    states: list[str]
    markets: list[MarketOption]
    validated_horizons: list[int]


class PriceOptionsResponse(BaseModel):
    data_start: dt.date
    data_end: dt.date
    projection_end: dt.date
    inflation_annual_pct: float
    today: dt.date
    max_horizon_days: int
    commodities: list[CommodityOption]
    unsupported_series: int


class MonthlyForecastRequest(BaseModel):
    commodity: str = Field(min_length=2, max_length=100)
    city: str | None = Field(default=None, max_length=60,
                             description="Maharashtra city; omit for the state-wide price")
    target_month: int = Field(ge=1, le=12)
    target_year: int = Field(ge=2026, le=2035)


class MonthlyForecastResponse(BaseModel):
    crop: str
    city: str | None
    series: str
    series_note: str | None
    latest_month: str
    latest_price: float
    target_month: str
    horizon_months: int
    beyond_model_horizon: bool
    predicted_price: float
    price_low: float
    price_high: float
    change_pct: float
    trend: str
    inflation_annual_pct: float
    inflation_effect_pct: float
    price_score: float
    history: list[dict]
    path: list[dict]
    peak: dict
    trough: dict
    reliability: dict
    explanation: dict
