import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Direction = Literal["Increasing", "Decreasing", "Stable"]


class GrowingLocation(BaseModel):
    """Where the crop is grown, as the farmer chose it from the location search. Used only to look up weather and soil for the result page;
    never a price-model input. The selling market stays in ``market``."""
    name: str = Field(min_length=2, max_length=100, description='Label of the chosen place, e.g. "Nashik, Maharashtra, India"')
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Enter where the crop is grown")
        return v

    @model_validator(mode="after")
    def both_or_neither(self) -> "GrowingLocation":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be given together")
        return self


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
    growing_location: GrowingLocation | None = Field(default=None, description=(
        "Where the crop is grown (optional for older clients). Weather and soil on the result page are looked up for this place; "
        "a plain label without coordinates is resolved again. Not a price-model input."))

    @field_validator("growing_location", mode="before")
    @classmethod
    def label_only(cls, v):
        return {"name": v} if isinstance(v, str) else v

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
    model_mae: float | None = None  # None for a historical estimate (no model involved)
    baseline_mae: float | None = None
    method: Literal["historical_baseline"] | None = None   # set on a target past the model's reach (a historical estimate)
    validation_reason: str | None = None                   # why this point is not validated, when the backend states it


class PeakInfo(BaseModel):
    date: dt.date
    horizon_days: int
    price: float
    reliable: bool
    diff_vs_target: float | None = None
    diff_pct: float | None = None


class StorageInfo(BaseModel):
    crop: str
    category: str
    max_hold_days: int
    farm_hold_days: int
    note: str


class SellOption(BaseModel):
    """Another selling date compared with the farmer's selected date."""
    date: dt.date
    horizon_days: int
    price: float
    extra_per_quintal: float
    extra_pct: float
    days_from_target: int
    error_pct: float
    meaningful: bool


class SellingAdvice(BaseModel):
    """Smart selling recommendation. Price fields are None only when the forecast has no
    usable price for the planned date (code UNAVAILABLE)."""
    code: Literal["WAIT", "NO_CLEAR_DIFFERENCE", "SELL_ON_TARGET", "STORAGE_LIMIT", "UNAVAILABLE"]
    label: str
    recommended_date: dt.date | None
    recommended_horizon_days: int
    recommended_price: float | None
    recommended_low: float | None
    recommended_high: float | None
    target_date: dt.date | None
    target_price: float | None
    target_low: float | None
    target_high: float | None
    extra_per_quintal: float | None
    extra_pct: float | None
    wait_days: int
    typical_error_pct: float | None
    explanation: str
    reason: str
    falls_after_target: bool
    needs_special_storage: bool
    best_before: SellOption | None = None
    best_after: SellOption | None = None
    alternative: SellOption | None = None
    beyond_storage: SellOption | None = None
    farm_option: SellOption | None = None
    peak: PeakInfo | None = None
    storage: StorageInfo
    considerations: list[str]
    disclaimer: str


class PricePoint(BaseModel):
    date: dt.date
    price: float


class EarlierYearPrice(BaseModel):
    year: int
    date: dt.date          # the target date's calendar day in that year
    price: float           # average reported price within a week of it, moved to the target year with inflation
    raw_price: float       # the same average as reported
    n: int                 # number of reported prices behind it
    weekly: dict[str, float] = {}   # same year, price at 7-day steps from the target date ("-14", "0", "7", ...), inflation adjusted


class SeriesInfo(BaseModel):
    state: str
    market: str
    commodity: str
    variety: str


class ModelInfo(BaseModel):
    version: str
    algorithm: str
    approach: str
    data_end: dt.date                          # newest price really reported in the loaded records
    trained_data_end: dt.date | None = None    # last date the loaded models were trained on


class ProjectionInfo(BaseModel):
    """Present when the requested date is after the dataset: features were taken from the
    same calendar day ``years_ahead`` years earlier and prices scaled by inflation."""
    reference_origin_date: dt.date
    reference_price: float
    years_ahead: int
    inflation_annual_pct: float
    price_level_factor: float


class SourceInfo(BaseModel):
    """Which data and method produced the forecast. ``fallback`` is true whenever it is not
    "the selected market, recent reports, trained model"."""
    kind: Literal["market", "state_median", "other_market"]
    method: Literal["trained_model", "historical_baseline"]
    requested_market: str
    requested_variety: str
    used_market: str
    used_variety: str
    data_age_days: int
    fallback: bool
    observations: int
    note: str | None = None   # set when the freshness gate replaced a stale market with the state median, or the planned date is past the model's reach
    # "historical_baseline" when only the planned date's price is a historical estimate (past the model's reach); the daily path stays the model's
    target_method: Literal["historical_baseline"] | None = None


class DatesInfo(BaseModel):
    """The dates of a forecast, kept apart. ``reference_date`` is the seasonal cut-off inside the
    dataset (the forecast start moved back whole years); nothing after it is used."""
    forecast_start: dt.date
    target_date: dt.date
    reference_date: dt.date
    origin_observation_date: dt.date
    latest_data_date: dt.date
    years_shifted: int


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
    # price around the target date in each earlier year (inflation adjusted): the history-only fallback when no forecast is shown
    earlier_years: list[EarlierYearPrice] = []
    # projections only: last year's prices from the start date to the selected date (inflation adjusted like `history`)
    reference_after: list[PricePoint] = []
    # the daily path to the end of the chart (it runs past the selected date) and the chart's last date
    chart_path: list[ForecastPoint] = []
    chart_end_date: dt.date | None = None
    # prices the market really reported in the last months of the records (not filled, not inflation-adjusted)
    observed: list[PricePoint] = []
    # the next 30 days one by one, the planned date and the best other date (ml/price_prediction/window.py)
    window: dict | None = None
    # the six environmental factors for the selling market's town and the selling date (temperature, humidity, rainfall, soil pH, soil
    # type, growing location) with units, dates, sources and availability. Context only: NOT inputs to the price model. Optional, so
    # older clients and saved responses keep working.
    environmental_factors: dict | None = None
    model: ModelInfo
    projection: ProjectionInfo | None = None
    source: SourceInfo
    dates: DatesInfo
    disclaimer: str
    # "model" or "context_only" for this crop and distance (see scripts/build_crop_policy.py)
    policy: dict | None = None
    # measured coverage of the displayed range for this crop and band; `shown` is false below 40 %
    range_info: dict | None = None
    # the last price this series actually reported, with its real date
    latest_recorded: dict | None = None
    # rise / fall / about_the_same for the target date and the days the model counts from the market's last report (verdict.py)
    verdict: dict | None = None
    horizon: dict | None = None


class PricePredictionResponse(PriceForecastResponse):
    id: int


class EvidenceItem(BaseModel):
    """One measured fact behind a factor (value, unit and the period it is compared with)."""
    label: str
    value: float | int
    unit: str
    reference: str | None = None
    reference_value: float | int | None = None
    change_pct: float | None = None
    source: str


class PriceFactor(BaseModel):
    factor: str
    title: str
    direction: Literal["up", "down"]
    strength: Literal["small", "moderate", "strong"]
    impact: Literal["higher", "lower", "small"]
    # contribution to the model output in log(price ratio) space; these add up across factors
    shap_value: float
    shap_scale: str
    evidence: list[EvidenceItem]
    evidence_available: bool
    observation: str          # A. what the data shows
    model_says: str           # B. which way / how strongly the model's calculation pushed
    meaning: str              # C. practical reading and its limits
    evidence_trend: Literal["up", "down", "flat"] | None = None
    sentence: str
    farmer_effect: str = ""   # plain-words sentence on what the model did with this factor


class ExplainReason(BaseModel):
    """A farmer-facing reason: a market category with measured evidence AND a model contribution."""
    id: str
    title: str
    direction: Literal["up", "down"]
    shap_value: float         # summed SHAP of the grouped features (log price-ratio space)
    evidence: str
    meaning: str
    trend: Literal["up", "down", "flat"] | None = None
    limited: bool = False


class ExplainNet(BaseModel):
    code: Literal["outweigh", "agree", "mixed", "flat"]
    forecast_side: Literal["up", "down"] | None = None
    higher: list[str] = []
    lower: list[str] = []
    up_total: float = 0.0
    down_total: float = 0.0


class ExplainNote(BaseModel):
    kind: str
    text: str
    projected: bool | None = None
    data_end: str | None = None


class ExplainSummary(BaseModel):
    reference_price: float
    predicted_price: float
    change_abs: float
    change_pct: float
    direction: str
    horizon_days: int
    within_typical_error: bool = False
    typical_error_pct: float | None = None
    headline: str


class ExplainReliability(BaseModel):
    basis: str
    model_mae: float | None = None
    baseline_mae: float | None = None
    beats_no_change: bool | None = None
    n_tests: int | None = None          # held-out forecasts behind the figures
    sufficient_data: bool = False


class ExplainRange(BaseModel):
    basis: str
    lower: float
    upper: float


class ExplainCompleteness(BaseModel):
    basis: str
    inputs_total: int
    inputs_missing: int
    missing: list[str]


class ExplainWeather(BaseModel):
    status: Literal["not_used", "used", "unavailable"]
    used: bool


class SimpleFactor(BaseModel):
    factor: str
    label: str
    meaning: str
    shap_value: float
    effect_pct: float
    direction: str
    small: bool


class SimpleFactors(BaseModel):
    factors: list[SimpleFactor]
    other: SimpleFactor


class PriceExplanation(BaseModel):
    horizon_days: int
    date: dt.date
    method: str
    output_space: str
    base_value: float
    base_change_pct: float
    prediction_change_pct: float
    all_small: bool
    summary: ExplainSummary
    farmer_explanation: list[str]
    factors: list[PriceFactor]
    higher_factors: list[str]
    lower_factors: list[str]
    reliability: ExplainReliability | None = None
    price_range: ExplainRange | None = None
    data_completeness: ExplainCompleteness
    data_limitations: list[str]
    weather: ExplainWeather
    strength_basis: str
    technical: dict
    simple: SimpleFactors | None = None
    algorithm: str | None = None
    main_factors: list[str] = []
    projected: bool = False
    reasons: list[ExplainReason] = []
    net_summary: ExplainNet | None = None
    what_it_means: str | None = None
    scope: ExplainNote | None = None
    data_basis: ExplainNote | None = None
    # evidence-first explanation (cards in rupees, dated evidence, trust block); see price_explainer_v3.py
    v3: dict | None = None
    # chart data built from this forecast's SHAP values (local) and the saved global importance; see price_charts.py
    charts: dict | None = None


class PriceExplainResponse(BaseModel):
    series: SeriesInfo
    forecast_origin_date: dt.date
    target_date: dt.date
    current_price: float
    projection: ProjectionInfo | None = None
    model: ModelInfo | None = None
    explanations: list[PriceExplanation]
    # which kinds of input the loaded model really has (from its feature list); the page labels a factor "Used by the model" only from this
    model_inputs: dict | None = None
    message: str | None = None
    source: SourceInfo | None = None
    horizon: dict | None = None
    latest_recorded: dict | None = None


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
    trained_data_end: dt.date | None = None
    projection_end: dt.date
    inflation_annual_pct: float
    today: dt.date
    max_horizon_days: int
    commodities: list[CommodityOption]
    unsupported_series: int
    min_listed_days: int


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
