# Architecture

## 1. System overview

```
┌────────────────────────────┐   HTTPS/JSON + JWT   ┌─────────────────────────────────────────┐
│ React (Vite) frontend      │ ───────────────────▶ │ FastAPI backend                          │
│ React Router · Axios ·     │                      │  routes → services → ML layer / ORM      │
│ Recharts · AuthContext     │ ◀─────────────────── │                                          │
└────────────────────────────┘                      │  ModelRegistry (loaded ONCE at startup)  │
                                                    │   ├─ PriceForecaster (daily, 1-60 days)  │
                                                    │   ├─ MonthlyPriceForecaster (XGBoost)    │
                                                    │   ├─ CropRecommender (XGBoost) + profit  │
                                                    │   └─ SHAP TreeExplainers                 │
                                                    │  SQLAlchemy ORM ──▶ MySQL (smartcrop_ai) │
                                                    └─────────────────────────────────────────┘
Offline (never per request):
 dataset/raw ─▶ scripts/prepare_price_data.py ─▶ dataset/processed + reports
             ─▶ scripts/train_price_model.py ─▶ trained_models/price_prediction/
             ─▶ scripts/train_recommendation_model.py ─▶ trained_models/crop_recommendation/
```

## 2. Folder structure

```
SmartCrop-AI/
├── README.md  ARCHITECTURE.md  DATASET.md  MODEL_EVALUATION.md
├── dataset/
│   ├── raw/                     original CSVs (never edited)
│   ├── processed/               cleaned rows, daily panel, seasonal index
│   ├── crop_price/              supported_series.csv
│   ├── crop_recommendation/     crop_season_calendar.csv, crop_to_commodity_map.csv
│   └── reports/                 data-quality report, training logs
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app, CORS, lifespan (loads models), error handler
│   │   ├── config/settings.py   env-based settings (pydantic-settings)
│   │   ├── database/            engine/session (connection.py), DeclarativeBase (base.py)
│   │   ├── models/              SQLAlchemy ORM tables
│   │   ├── schemas/             Pydantic request/response models
│   │   ├── routes/              auth, price_prediction, crop_recommendation, history
│   │   ├── services/            business logic: price, recommendation, history, model versions
│   │   ├── auth/                jwt.py, password.py (bcrypt), dependencies.py (current user)
│   │   └── ml/
│   │       ├── common/          paths, Indian season conventions
│   │       ├── price_prediction/  preprocessing, features (shared train/serve), forecaster
│   │       ├── crop_recommendation/ recommender (scoring + integration)
│   │       ├── explainability/  SHAP → farmer-friendly text (price & crop)
│   │       └── registry.py      loads models once; 503 if missing
│   ├── alembic/ + alembic.ini   migrations (0001_initial_schema)
│   ├── scripts/                 data prep, training, weight sensitivity
│   ├── trained_models/          joblib models + metrics + metadata
│   ├── notebooks/               (optional exploration; the pipeline lives in scripts/)
│   ├── tests/                   pytest suite (47 tests)
│   └── requirements.txt, .env.example
└── frontend/
    ├── src/
    │   ├── components/ (+ charts/)  reusable UI and Recharts charts
    │   ├── pages/                   Login, Register, Dashboard, PricePrediction, PriceResult,
    │   │                            CropRecommendation, CropResult, History, Profile, NotFound
    │   ├── layouts/                 AppLayout (sidebar), AuthLayout
    │   ├── services/                axios instance + API wrappers
    │   ├── context/AuthContext.jsx  session state, login/register/logout
    │   ├── hooks/                   useAuth, useAsync
    │   ├── utils/                   formatting, validation, constants
    │   ├── App.jsx, main.jsx, index.css
    └── package.json, .env.example
```

## 3. MySQL database schema

Created by Alembic migration `backend/alembic/versions/0001_initial_schema.py`
(InnoDB, utf8mb4). A test (`tests/test_migrations.py`) checks that the migration produces
exactly the schema described by the ORM models.

```
users ─┬─< price_predictions >── model_versions
       └─< crop_recommendations >── model_versions
                └─< recommendation_results
```

| Table | Columns | Keys / constraints |
|---|---|---|
| **users** | id, name, email, password_hash, created_at, updated_at | PK id; **UNIQUE email** |
| **model_versions** | id, model_type, version, algorithm, metrics (JSON), trained_at, registered_at | UNIQUE (model_type, version) |
| **price_predictions** | id, user_id, model_version_id, state, market, commodity, variety, input_date, forecast_origin_date, arrivals, horizon_days (days from input_date to the target date), current_price, predicted_price, predicted_low, predicted_high, predicted_direction (ENUM Increasing/Decreasing/Stable), future_trend (JSON: daily forecast path), sell_hold_suggestion, created_at | FK user_id → users.id ON DELETE CASCADE; FK model_version_id → model_versions.id ON DELETE SET NULL; INDEX (user_id, created_at) |
| **crop_recommendations** | id, user_id, model_version_id, nitrogen, phosphorus, potassium, temperature, humidity, ph, rainfall, soil_type (nullable), month, season, state, created_at | FK user_id → users.id CASCADE; INDEX (user_id, created_at) |
| **recommendation_results** | id, recommendation_id, rank, crop_name, recommendation_score, agronomic_score, seasonal_score, price_score (nullable), price_available, predicted_price (nullable), expected_price_trend (nullable), explanation (JSON) | FK recommendation_id → crop_recommendations.id CASCADE; UNIQUE (recommendation_id, rank) |

Prices are `DECIMAL(12,2)`. `model_versions` records which trained model produced each stored
result, so history stays interpretable after retraining.

## 4. Authentication & authorization

* **Register** → password validated (8–72 bytes, letter + digit) → hashed with **bcrypt**
  (cost 12) → user row → JWT returned. Emails are normalised to lower case; duplicates → 409.
* **Login** → bcrypt verify → JWT (HS256, `sub` = user id, `type` = access, `iat`, `exp`;
  lifetime `ACCESS_TOKEN_EXPIRE_MINUTES`). Wrong email and wrong password give the same 401.
* **Protected endpoints** depend on `get_current_user` (HTTP Bearer): invalid, forged or
  expired tokens → 401.
* **Authorization**: every history query filters by `user_id` of the token's user. Reading or
  deleting another user's record returns **404** (existence is not revealed).
* The secret, DB credentials and CORS origins come only from environment variables
  (`backend/.env`, git-ignored). Passlib was not used because it is unmaintained and
  incompatible with bcrypt ≥ 4.1; the `bcrypt` library is used directly.
* Frontend: token in `localStorage`, attached by an Axios interceptor; any 401 clears the
  session; `ProtectedRoute` guards every page except login/register.

## 5. API reference

Base URL `http://localhost:8000`. Interactive docs: `/docs` (Swagger) and `/redoc`.
All endpoints except register/login/health need `Authorization: Bearer <token>`.

| Method | Path | Purpose | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create account → token + user | 201 |
| POST | `/api/auth/login` | Log in → token + user | 200 |
| GET | `/api/auth/me` | Current user | 200 |
| PUT | `/api/auth/me` | Update name / change password | 200 |
| GET | `/api/price-prediction/options` | Supported crops, markets (+ default variety), today's date, max horizon, validated horizon per crop | 200 |
| POST | `/api/price-prediction/predict` | Daily forecast from **today** to the target date (and later validated dates) + best-time-to-sell advice, **saved to history** | 201 |
| POST | `/api/price-prediction/trend` | Same as predict, not saved; optional `as_of` re-opens a saved prediction | 200 |
| POST | `/api/price-prediction/explain` | Plain-language SHAP explanation for the target date (and the suggested date) | 200 |
| POST | `/api/price-prediction/monthly-forecast` | Price for a crop/city in a future month: monthly path, range, SHAP | 200 |
| GET | `/api/crop-recommendation/options` | 7 crops, 11 cities, crop calendar, economics assumptions, input ranges | 200 |
| POST | `/api/crop-recommendation/recommend` | All 7 crops ranked (suitability, timing, profit) with economics, price path, timeline, SHAP; **saved** | 201 |
| POST | `/api/crop-recommendation/analyze` | Same as recommend, not saved (reopens history items) | 200 |
| POST | `/api/crop-recommendation/explain` | Classifier SHAP for any crop | 200 |
| GET | `/api/history/summary` | Counts + 5 most recent of each | 200 |
| GET | `/api/history/price?limit&offset` | Own price predictions (paged) | 200 |
| GET/DELETE | `/api/history/price/{id}` | One own prediction | 200/204 |
| GET | `/api/history/recommendations?limit&offset` | Own recommendations (paged) | 200 |
| GET/DELETE | `/api/history/recommendations/{id}` | One own recommendation | 200/204 |
| GET | `/api/health` | Liveness + whether models loaded | 200 |

Errors: 401 unauthenticated, 404 not found / not owned, 409 duplicate email,
422 validation error **or** a forecast that cannot be made honestly (date outside the data,
unsupported series, too little history — with a plain-language message), 503 model not
loaded, 500 unexpected (logged, generic message).

**Price request**
```json
{ "state": "Maharashtra", "market": "All markets (state median)", "commodity": "Onion",
  "target_date": "2026-10-20" }
```
The forecast always starts from the server's current date for `/predict`. `variety` is
optional (the market's aggregate or most-reported variety is used); arrivals, lags and rolling
averages are taken from the data, never typed in. `/trend` and `/explain` also accept
`as_of` to rebuild a saved prediction.

**Crop request**
```json
{ "nitrogen": 80, "phosphorus": 45, "potassium": 85, "temperature": 23, "humidity": 58,
  "ph": 6.8, "rainfall": 70, "state": "Maharashtra", "city": "Nashik",
  "planting_month": 11, "selling_month": 3, "area_acres": 1, "planting_year": null,
  "soil_type": null }
```
`planting_year` defaults to the next occurrence of the planting month; the selling month is
the first occurrence after planting.

## 6. ML pipeline

### Price forecasting
1. **Clean** (`preprocessing.py`): parse/validate, merge same-day duplicates, cap isolated
   outliers (backward-looking rule), log every step → data-quality report.
2. **Panel** (`features.py::build_daily_panel`): continuous daily calendar per series, price
   carried forward ≤ 7 days, plus a state-median series per crop.
3. **Features** (`features.py::compute_features`, identical in training and serving):
   lag changes 1/3/7/14/30 days; gaps to rolling means 7/14/30; 30-day volatility; momentum
   (7- vs 30-day mean); 7-day % change; min-max spread; arrivals (log) and arrivals vs 30-day
   mean; gap to the state median and state 7-day change; month, week, weekday, season,
   day-of-year sin/cos; crop/market/variety codes. State is not a feature (only one state).
4. **Target**: `log(price[t+h]/price[t])` for every h = 1 … 60 days; the target price must be
   reported within 3 days of t+h. **One direct multi-horizon model**: each training row is an
   (origin, h) pair with the origin's features plus h and the target day-of-year (sin/cos).
   Plain (h-day change) and rate (daily change × h) target forms of Random Forest and XGBoost
   are compared per horizon (MODEL_EVALUATION.md §1).
   No recursion — a predicted price is never fed back as an input, so no future arrivals or
   prices have to be guessed and errors do not compound from day to day.
5. **Models / validation**: see `MODEL_EVALUATION.md`.
6. **Serving**: the start date (today) is snapped back to the last reported day (≤ 7 days);
   dates after the dataset use the same calendar day of the last data year, scaled by the
   inflation assumption (seasonal projection). Features come from data up to that day only;
   the model predicts all 60 days at once and per-crop, per-horizon residual quantiles give
   the range. If a feature (e.g. arrivals) is missing the API returns a 422 with a plain
   message instead of a forecast. Each horizon is served by the model chosen for it in CV
   (days 1–12 XGBoost rate form, 13–35 Random Forest rate form, 36–60 Random Forest plain).
   Every day carries `beats_baseline`: validated only if the forecaster beat "no change" for
   that crop at exactly that horizon and over ±3 days. The returned path runs to the target
   date and beyond it up to the crop's last validated day (`last_validated_days`).
7. **Best time to sell** (`selling_advice.py`): compares the target date with today, earlier
   validated dates and later validated dates up to a conservative storage limit for the crop
   (7 days for tomato/brinjal/cauliflower, 14 for cabbage, 60 for onion/potato/wheat). Another
   date is recommended only if its predicted price differs by more than the model's median
   CV error at the longer horizon → WAIT or SELL_EARLIER; otherwise SELL_ON_TARGET or
   NO_CLEAR_DIFFERENCE ("compare mandi prices"); an unvalidated target date → UNCERTAIN.
   Returns recommended date/price, extra ₹ per quintal and %, days to wait, the overall peak,
   storage guidance and the factors to check. Storage costs are unknown, so the UI lets the
   farmer enter one to see the net gain.

### Monthly price forecasting (selling month)
1. **Panel**: monthly median modal price + arrivals per (city, crop) over the city's markets
   (`city_market_map.csv`) and a state-wide series per crop.
2. **Real prices**: deflated with 5 %/year assumed inflation; target = real log change over
   h = 1–24 months, minus the crop's historical real trend (de-drifting, not projected).
3. **XGBoost regressor** on horizon, calendar months, crop, city, momentum, level vs
   averages, volatility, arrivals, city premium and leakage-free seasonal priors.
4. **Serving**: from the series' last month (Dec 2025) a monthly path to the selling month
   (and through the crop's storage window); nominal = latest × exp(model) × inflation;
   10–90 % range from out-of-fold residuals. Missing city series → state series, stated.

### Crop recommendation (smart economic)
1. **XGBoost classifier** on N, P, K, temperature, humidity, pH, rainfall, city, planting
   month, selling month, growing months (synthetic 7-crop dataset) → probability per crop.
2. **Timing** from `crop_season_calendar.csv`: planting-window fit + whether the crop is
   harvest-ready, storable, not ready or spoiled at the selling month.
3. **Profit** (`app/ml/economics/profit.py`): yield × losses × forecast price − marketing,
   cultivation (inflated) and storage costs → net profit, ROI, break-even price, low/high
   scenarios; best selling month across the harvest + storage window.
4. **Overall** = 0.40·A + 0.20·T + 0.40·P(=50+50·tanh ROI). Recommended = probability ≥ 5 %
   and feasible; all 7 crops are returned ranked for comparison.

## 7. SHAP methodology

* `shap.TreeExplainer` (exact, tree-path-dependent) on the deployed tree models (daily price model, XGBoost monthly price and crop), computed
  per request; nothing is cached or invented. Additivity is unit-tested.
* **Price**: SHAP values are in log-change space; a contribution *s* ≈ (e^s − 1)·100 % of the
  forecast, computed for the target-date row (and the suggested date's row). Technical
  features are grouped into 10 farmer-facing factors (recent prices, last month's movement,
  recent averages, ups and downs, arrivals, prices across Maharashtra, seasonal pattern, how
  far ahead the date is, price level, crop/market behaviour). Each factor = the **observed
  fact** (e.g. "Onion prices fell about 1.1% over the past week") + an impact label: *supports
  a higher price*, *supports a lower price* or *small influence* (< 1 %). The UI shows the top
  three, worded as associations the model learned ("the model links this to…"), never as
  causes; raw SHAP values stay in the API response only. For a seasonal projection the market
  facts are labelled "Same time last year".
* **Monthly price**: SHAP in real log-change space; base + Σ SHAP + inflation =
  log(forecast / latest price). Grouped into seasonal pattern, market supply, recent movement,
  price vs normal, volatility, months until selling, city market and crop behaviour; each
  paired with an observed fact (e.g. "November prices averaged 35 % above the yearly average";
  "arrivals typically drop 20 %").
* **Crop**: per-class SHAP in log-odds (XGBoost margin), also shown as signed share of total
  |SHAP|, grouped into soil health, weather compatibility, timing and location for the
  "Why this recommendation?" panel (plus a market-demand pillar from the price SHAP and profit). Each input is compared
  with that crop's 5th–95th percentile range in the training data (a statement about the
  data, not agronomic advice). Positive contributors become "main reasons"; values outside the
  typical range that count against the crop become "limitations".
* Charts: diverging horizontal bars (blue = pushes up / supports, red = pulls down / against),
  each with a signed value label so colour is never the only cue.

## 8. Frontend flow

`/login`, `/register` → `/dashboard` → `/price-prediction` → (POST predict) →
`/price-prediction/result` (trend + explain fetched) ; `/crop-recommendation` → (POST
recommend) → `/crop-recommendation/result` (dashboard: top-3 cards, 7-crop profit/revenue
chart, monthly price trend with peak/low/selling markers, growth timeline, "Why" panel with
SHAP charts; Tailwind utilities on top of `index.css`) ; `/history` (tabs, paging, delete with
confirmation; items reopen their result pages via `?id=`) ; `/profile`. Every data view has
loading, error and empty states.
