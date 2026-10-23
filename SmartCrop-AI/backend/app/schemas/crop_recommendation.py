from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.ml.crop_recommendation.features import normalize_soil_type


class SoilWeatherInputs(BaseModel):
    """Physical validity limits; values outside the training data range are accepted
    but produce a warning because the model would be extrapolating."""
    nitrogen: float = Field(ge=0, le=300)
    phosphorus: float = Field(ge=0, le=300)
    potassium: float = Field(ge=0, le=400)
    temperature: float = Field(ge=-10, le=55, description="°C, growing-period average")
    humidity: float = Field(ge=0, le=100, description="%")
    ph: float = Field(ge=0, le=14)
    rainfall: float = Field(ge=0, le=3000, description="mm, growing-period monthly average")

    def model_inputs(self) -> dict[str, float]:
        return {"N": self.nitrogen, "P": self.phosphorus, "K": self.potassium,
                "temperature": self.temperature, "humidity": self.humidity, "ph": self.ph,
                "rainfall": self.rainfall}


class TimingInputs(SoilWeatherInputs):
    soil_type: Literal["sandy_loam", "loam", "clay_loam", "alluvial", "unknown"] = Field(
        default="unknown", description="Missing / 'Not sure / skip' is sent as 'unknown'")
    city: str = Field(min_length=2, max_length=60)
    planting_month: int = Field(ge=1, le=12)
    selling_month: int = Field(ge=1, le=12, description="Intended selling month")

    @field_validator("soil_type", mode="before")
    @classmethod
    def soil(cls, v):
        return normalize_soil_type(v)

    def recommender_inputs(self) -> dict:
        """The 7 numeric inputs plus soil type, as the model pipeline expects them."""
        return {**self.model_inputs(), "soil_type": self.soil_type}

    @field_validator("city")
    @classmethod
    def strip(cls, v: str) -> str:
        return " ".join(v.split())


class CropRequest(TimingInputs):
    state: Literal["Maharashtra"] = "Maharashtra"
    area_acres: float = Field(default=1.0, gt=0, le=1000)
    planting_year: int | None = Field(default=None, ge=2024, le=2035,
                                      description="Defaults to the next occurrence of the "
                                                  "planting month")


class CropExplainRequest(TimingInputs):
    crop_name: str = Field(min_length=2, max_length=60)


class CropFactor(BaseModel):
    feature: str
    label: str
    group: str
    group_label: str
    value: str
    shap_value: float
    share_pct: float
    direction: Literal["supports", "against"]
    typical_low: float | None
    typical_high: float | None
    within_typical_range: bool | None
    unit: str
    text: str


class FactorGroup(BaseModel):
    group: str
    label: str
    shap_value: float
    share_pct: float
    direction: Literal["supports", "against"]
    points: list[str]


class WhyPillar(BaseModel):
    key: str
    title: str
    direction: Literal["supports", "against"]
    share_pct: float | None
    points: list[str]


class Economics(BaseModel):
    area_acres: float
    status: str
    months_stored: int
    feasible: bool
    selling_price: float
    price_low: float
    price_high: float
    yield_q_per_acre: float
    effective_yield_q: float
    gross_revenue: float
    marketing_cost: float
    cultivation_cost: float
    storage_cost: float
    total_cost: float
    net_profit: float
    net_profit_low: float
    net_profit_high: float
    roi_pct: float
    break_even_price: float | None
    profit_score: float


class Timeline(BaseModel):
    planting: str
    harvest_start: str
    harvest_end: str
    storage_until: str | None
    selling: str
    selling_offset: int
    growth_months_min: int
    growth_months_max: int
    max_storage_months: int
    storable: bool
    status: str
    months_stored: int
    optimal_selling: str | None
    optimal_offset: int | None
    optimal_net_profit: float | None
    planting_months: list[int]
    planting_in_window: bool


class SellingOption(BaseModel):
    offset: int
    month: str
    price: float
    net_profit: float
    status: str


class RangeFitPart(BaseModel):
    within: int
    total: int
    items: dict[str, bool]


class RangeFit(BaseModel):
    soil: RangeFitPart
    weather: RangeFitPart


class CropStatus(BaseModel):
    key: str
    tone: str


class ScorePoints(BaseModel):
    agronomic: float
    timing: float
    profit: float


class RankingReason(BaseModel):
    code: str
    points: float
    params: dict[str, float | int]


class RankingExplanation(BaseModel):
    best_overall: str | None
    highest_profit: str | None
    same_crop: bool
    profit_gap: float | None
    reasons: list[RankingReason]


class CropResult(BaseModel):
    rank: int
    crop_name: str
    recommended: bool
    eligible: bool
    profitable: bool
    profit_rank: int | None
    forecast_reliable: bool | None
    range_fit: RangeFit
    feasible: bool
    low_agronomic_suitability: bool
    probability: float
    model_match_score: float
    recommendation_score: float
    agronomic_score: float
    timing_score: float
    profit_score: float
    profit_score_used: float
    forecast_reliability: str
    # "context_only" when the price model is not reliable enough for this crop (crop_policy.json): its profit is a rough estimate
    price_policy: Literal["model", "context_only"] = "model"
    score_points: ScorePoints
    status: CropStatus
    seasonal_score: float
    price_score: float | None
    summary: str
    reasons: list[str]
    limitations: list[str]
    important_factors: list[CropFactor]
    factor_groups: list[FactorGroup]
    shap_base_value: float
    economics: Economics | None
    timeline: Timeline
    selling_options: list[SellingOption]
    market: dict | None = Field(description="Monthly price forecast: history, path, SHAP")
    why: list[WhyPillar]


class CropAnalysis(BaseModel):
    state: str
    city: str
    planting_month: int
    selling_month: int
    planting_date: str
    selling_date: str
    growing_months: int
    area_acres: float
    generated_at: str
    best_overall: str | None
    highest_profit: str | None
    ranking_explanation: RankingExplanation
    season_used: str
    results: list[CropResult]
    weights: dict[str, float]
    warnings: list[str]
    notes: list[str]
    model: dict


class CropRecommendationResponse(CropAnalysis):
    id: int


class CropExplainResponse(BaseModel):
    crop: str
    probability: float
    base_value: float
    margin: float
    method: str
    summary: str
    reasons: list[str]
    limitations: list[str]
    factors: list[CropFactor]
    groups: list[FactorGroup]


class RecommendationOptions(BaseModel):
    state: str
    crops: list[str]
    cities: list[str]
    calendar: dict[str, dict]
    economics: dict[str, dict]
    input_ranges: dict[str, list[float]]
    soil_types: list[str]
    price_data_end: str
    inflation_annual_pct: float


class FeatureRange(BaseModel):
    """Dataset min/max, the API validity limits (hardMin/hardMax) and the usual (5th-95th percentile) range per crop."""
    min: float
    max: float
    hardMin: float
    hardMax: float
    perCrop: dict[str, list[float]]
