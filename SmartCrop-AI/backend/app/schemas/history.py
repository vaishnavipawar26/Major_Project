from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PriceHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    state: str
    market: str
    commodity: str
    variety: str
    input_date: date
    forecast_origin_date: date
    arrivals: float | None
    horizon_days: int
    current_price: float
    predicted_price: float
    predicted_low: float | None
    predicted_high: float | None
    predicted_direction: str
    future_trend: list | None
    sell_hold_suggestion: str
    created_at: datetime
    # added when the history is read (no database column): "model" / "context_only" for this crop and distance,
    # and the last price the series actually reported. The saved predicted_price is the model's own number.
    policy: dict | None = None
    latest_recorded: dict | None = None
    verdict: dict | None = None     # rise / fall / about_the_same, from the same rule as the result page


class RecommendationResultItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    rank: int
    crop_name: str
    recommendation_score: float
    agronomic_score: float
    seasonal_score: float
    price_score: float | None
    price_available: bool
    predicted_price: float | None
    expected_price_trend: str | None
    timing_score: float | None = None
    profit_score: float | None = None
    expected_revenue: float | None = None
    expected_cost: float | None = None
    expected_profit: float | None = None
    recommended: bool | None = None
    explanation: dict | None = None


class RecommendationHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nitrogen: float
    phosphorus: float
    potassium: float
    temperature: float
    humidity: float
    ph: float
    rainfall: float
    soil_type: str | None
    month: int
    season: str
    state: str
    city: str | None = None
    selling_month: int | None = None
    planting_date: str | None = None
    selling_date: str | None = None
    area_acres: float | None = None
    budget_inr: float | None = None
    priority: str | None = None
    risk_level: str | None = None
    personal_pick: str | None = None      # added when the history is read (the plan is re-derived, not stored)
    created_at: datetime
    results: list[RecommendationResultItem]


class Page(BaseModel):
    total: int
    limit: int
    offset: int


class PriceHistoryPage(Page):
    items: list[PriceHistoryItem]


class RecommendationHistoryPage(Page):
    items: list[RecommendationHistoryItem]


class HistorySummary(BaseModel):
    total_price_predictions: int
    total_crop_recommendations: int
    recent_predictions: list[PriceHistoryItem]
    recent_recommendations: list[RecommendationHistoryItem]
