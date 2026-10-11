# SmartCrop AI

**Explainable crop price prediction and profit-aware crop recommendation for Maharashtra farmers.**

SmartCrop AI is a full-stack web application (React + FastAPI + MySQL + scikit-learn/XGBoost) that
helps a farmer answer two practical questions, with reasons they can check:

1. **"What will my crop sell for on the day I plan to sell — and is there a better day?"**
2. **"Which crop should I plant to earn the most when I sell?"**

> **Status:** academic major project / working prototype. All forecasts and recommendations are
> model-based estimates, not guarantees. See [Limitations](#r-limitations).

---

## Table of contents

- [A. Overview](#a-overview)
- [B. Features](#b-features)
- [C. Screenshots and demo](#c-screenshots-and-demo)
- [D. Technologies used](#d-technologies-used)
- [E. System architecture](#e-system-architecture)
- [F. Price prediction — how it works](#f-price-prediction--how-it-works)
- [G. Crop recommendation — how it works](#g-crop-recommendation--how-it-works)
- [H. Datasets and data sources](#h-datasets-and-data-sources)
- [I. Project structure](#i-project-structure)
- [J. Installation and setup (Windows)](#j-installation-and-setup-windows)
- [K. Running the project](#k-running-the-project)
- [L. Environment variables](#l-environment-variables)
- [M. API reference](#m-api-reference)
- [N. Example workflows](#n-example-workflows)
- [O. Model training and evaluation](#o-model-training-and-evaluation)
- [P. Testing and troubleshooting](#p-testing-and-troubleshooting)
- [Q. Security and privacy](#q-security-and-privacy)
- [R. Limitations](#r-limitations)
- [S. Future improvements](#s-future-improvements)
- [T. Contributors](#t-contributors)
- [U. Contributing](#u-contributing)
- [V. License](#v-license)
- [W. Acknowledgements and references](#w-acknowledgements-and-references)

Further reading: [ARCHITECTURE.md](ARCHITECTURE.md) (schema, auth, full ML pipeline, SHAP) ·
[DATASET.md](DATASET.md) (data profiles and preprocessing) ·
[MODEL_EVALUATION.md](MODEL_EVALUATION.md) (validation method and every measured metric).

---

## A. Overview

Mandi (APMC market) prices for vegetables and grains move sharply from week to week and across
seasons. A farmer deciding **when to sell** — or **what to plant** months before selling — usually
has only today's price to go on. SmartCrop AI combines three years of Maharashtra mandi price
reports with machine-learning models to give:

- a **day-by-day price forecast** (up to 60 days ahead) for a chosen crop and market, with a
  likely range, a "best time to sell" suggestion and a plain-language explanation; and
- a **ranked comparison of 7 crops** for the farmer's soil, weather, city and planting/selling
  months, including expected profit, timing feasibility and the reasons behind the ranking.

**Coverage:** 7 crops — Brinjal, Cabbage, Cauliflower, Onion, Potato, Tomato, Wheat — in
Maharashtra. **Intended users:** farmers, farmer-producer organisations and agricultural
advisers exploring selling and planting decisions; also reviewers of the ML approach.

## B. Features

| Area | What is implemented |
|---|---|
| **Accounts** | Register, log in (JWT), edit name, change password, log out. Every page except login/register requires a session. |
| **Crop price prediction** | Choose crop, market (or the state-wide median) and the date you plan to sell (1–60 days from today). The API forecasts **every day** from today to that date and beyond, up to the crop's last validated day. |
| **Forecast chart** | Recharts chart of recent/reference prices, the daily forecast, its likely range (10–90 % of past errors), today, your date and the suggested date. Days where the model was not validated are drawn as "less reliable". |
| **Best time to sell** | Compares your date with earlier and later validated dates (within a per-crop storage limit) and recommends another date only if the price difference is larger than the model's typical error. Includes an optional storage-cost calculator that you fill in. |
| **Price explanation (SHAP)** | "Why is this price predicted?" — the top factors the model relied on (recent prices, arrivals, season, state-wide prices, …), each with the observed fact and whether it pushes the price up or down. |
| **Crop recommendation** | Enter soil (N, P, K, pH), weather (temperature, humidity, rainfall), city, planting and selling month and field size. All 7 crops are ranked on soil/weather suitability, timing feasibility and expected profit; up to 3 are marked *recommended*. |
| **Crop result dashboard** | Profit/revenue comparison chart for all 7 crops, projected monthly price trend for the selling month, profit/loss breakdown, growth/harvest/storage timeline and a "Why this recommendation?" panel with SHAP charts. |
| **History** | Every prediction and recommendation is saved to the user's account; the History page shows totals, paged tables, re-opens results and deletes records. Users can only see their own records. |
| **Dashboard** | Landing page with shortcuts to the three main tools. |

## C. Screenshots and demo

> **Screenshots: to be added.** No screenshots are committed yet. Suggested location:
> `docs/screenshots/` (e.g. `dashboard.png`, `price-result.png`, `crop-result.png`,
> `history.png`), then reference them here with relative links such as
> `![Dashboard](docs/screenshots/dashboard.png)`. Do not include real user names, e-mails or
> tokens in screenshots.

**Live demo:** none — the project currently runs locally only.

## D. Technologies used

| Layer | Technology | Role in this project |
|---|---|---|
| Frontend | **React 18**, **Vite 5** | Single-page app and dev server/build (port 5173) |
| | **React Router 6** | Client-side routes and protected pages |
| | **Axios** | API calls; interceptor attaches the JWT and handles 401s |
| | **Recharts** | Price forecast, monthly price, profit comparison and SHAP charts |
| | **Tailwind CSS 3** + custom CSS | Utility classes on top of the app's own design system (`src/index.css`) |
| | **lucide-react** | Line icons throughout the UI |
| Backend | **Python 3.13**, **FastAPI**, **Uvicorn** | REST API with automatic OpenAPI docs |
| | **Pydantic v2**, **pydantic-settings** | Request/response validation, configuration from `.env` |
| | **SQLAlchemy 2**, **Alembic**, **PyMySQL** | ORM, schema migrations, MySQL driver |
| | **PyJWT**, **bcrypt** | Access tokens (HS256) and password hashing |
| Database | **MySQL 8** | Users, saved predictions and recommendations, model versions |
| Machine learning | **pandas**, **NumPy**, **PyArrow** | Data cleaning, feature engineering, parquet panels |
| | **scikit-learn** (Random Forest) | Daily price forecaster (days 13–60) |
| | **XGBoost** | Daily price forecaster (days 1–12), monthly price model, crop classifier |
| | **SHAP** (`TreeExplainer`) | Per-prediction explanations |
| | **joblib**, **matplotlib** | Model persistence; confusion-matrix plot during training |
| Testing | **pytest**, **httpx** (FastAPI `TestClient`) | 47 backend tests |

Exact versions: [`backend/requirements.txt`](backend/requirements.txt) and
[`frontend/package.json`](frontend/package.json).

## E. System architecture

```mermaid
flowchart LR
    U([User / browser]) --> FE["React frontend<br/>(Vite, port 5173)"]
    FE -- "JSON + Bearer JWT<br/>(Axios)" --> API["FastAPI backend<br/>(port 8000)"]
    API --> AUTH["Auth: bcrypt + JWT"]
    API --> REG["ModelRegistry<br/>(models loaded once at startup)"]
    REG --> PF["Daily price forecaster<br/>XGBoost + Random Forest"]
    REG --> MF["Monthly price model<br/>XGBoost"]
    REG --> CR["Crop classifier XGBoost<br/>+ timing + profit engine"]
    PF & MF & CR --> SHAP["SHAP explanations"]
    API <--> DB[("MySQL<br/>users, history,<br/>model versions")]
    DATA[["dataset/processed/*<br/>trained_models/*"]] --> REG
    API -- "forecast / ranking<br/>+ explanation" --> FE
```

- The **frontend** never talks to the models directly; it calls the REST API with the user's token.
- The **backend** loads every trained model and the processed price panels **once at startup**
  (`app/ml/registry.py`); requests never train anything. If a model is missing, the related
  endpoints return **503** and `/api/health` reports which model is not loaded.
- **Training is offline**, via the scripts in `backend/scripts/` (see [section O](#o-model-training-and-evaluation)).
- Saved predictions/recommendations reference the `model_versions` row that produced them.

Details (folder-by-folder, DB schema, auth flow): [ARCHITECTURE.md](ARCHITECTURE.md).

## F. Price prediction — how it works

Code: `backend/app/ml/price_prediction/` (`preprocessing.py`, `features.py`, `forecaster.py`,
`selling_advice.py`), explanations in `backend/app/ml/explainability/price_explainer.py`.

### Objective
Predict the **modal mandi price (₹/quintal)** of a crop in a market for **every day from 1 to 60
days ahead**, and say whether selling on a different day is likely to be better.

### Data loading and preprocessing
1. `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv` is validated and cleaned:
   same-day duplicates merged (median price, averaged arrivals), isolated outliers capped with a
   backward-looking rule, `Min_Price ≤ 0` set to missing. Every step is logged to
   `dataset/reports/price_data_quality.md`.
2. Each (market, crop, variety) series is placed on a continuous **daily calendar**; prices are
   carried forward at most 7 days. A **state-median series** per crop is added
   ("All markets (state median)").
3. Only series with **≥ 180 reported days** are offered (`dataset/crop_price/supported_series.csv`).

### Model inputs (features)
Computed by the same function in training and serving (`features.py::compute_features`), using
only data **up to the forecast start date**:

| Group | Features |
|---|---|
| Recent price movement | log price; changes over the last 1/3/7/14/30 days; 7-day % change |
| Rolling statistics | gap to 7/14/30-day rolling means; 30-day volatility; momentum (7- vs 30-day mean); min–max spread |
| Supply | arrivals (log) and arrivals vs their 30-day mean |
| State market | gap to the state-median price; state 7-day change |
| Calendar | month, week, weekday, season, day-of-year (sin/cos) at the start date **and** at the target date |
| Identity | crop, market and variety codes |
| Horizon | number of days ahead, *h* |

Arrivals, lags and rolling averages are taken from the data — the user never types them in.

### Model and how a forecast is generated
- **Target:** `log(price[t+h] / price[t])` — the relative change over *h* days.
- **Direct multi-horizon model, no recursion.** Each training row is a (start date, *h*) pair;
  all 60 days are predicted directly from information known at the start date. A predicted
  price is **never** fed back as an input for the next day, so future arrivals or prices never
  have to be guessed and errors do not compound.
- **Model per horizon**, chosen by cross-validated error (recorded in
  `backend/trained_models/price_prediction/metadata.json`):

  | Days ahead | Model |
  |---|---|
  | 1–12 | XGBoost, "rate" form (predicts the average daily change) |
  | 13–35 | Random Forest (scikit-learn), "rate" form |
  | 36–60 | Random Forest, "plain" form (predicts the total change) |

- **Start date = today.** The price data ends on **31 Dec 2025**, so for later dates the
  forecaster uses the **same calendar day of the last data year** and scales prices by an
  assumed **5 %/year inflation** (a *seasonal projection*). The result page says so explicitly.
- **Likely range:** the 10th–90th percentile of the model's out-of-fold cross-validation errors
  for that crop and horizon — an empirical error band, not a confidence level.
- **Direction:** *Increasing/Decreasing* only if the predicted change exceeds the typical error;
  otherwise *Stable*.
- **Validated days:** each day carries `beats_baseline` — true only if, in cross-validation,
  the model beat the "price stays the same" baseline for that crop at that horizon (and ±3 days).
  Unvalidated days are shown as less reliable and never used for the selling advice.

### Chart data
`POST /api/price-prediction/predict` (or `/trend`) returns the history window, the daily `path`
(date, predicted price, range, direction, `beats_baseline`), the target day and the advice. The
frontend (`components/charts/PriceTrendChart.jsx`) draws these values directly — the UI does no
forecasting of its own.

### Best time to sell (`selling_advice.py`)
- Candidates: today, earlier **validated** dates, and later **validated** dates up to a
  per-crop storage limit — **7 days** for tomato, brinjal and cauliflower, **14** for cabbage,
  **60** for onion, potato and wheat (general post-harvest guidance, not learned from data).
- Another date is recommended only if its predicted price differs from your date's by more than
  the model's typical error → `WAIT` or `SELL_EARLIER`; otherwise `SELL_ON_TARGET` or
  `NO_CLEAR_DIFFERENCE`. If your date itself is not validated → `UNCERTAIN`.
- **Storage cost is not modelled** (it is unknown). The result page has an optional calculator:
  the farmer enters a cost per quintal per day to see the expected gain after storage.
  Transport, commission and quality loss are not included.

### Explanation (SHAP)
`shap.TreeExplainer` is run on the deployed model for the target date (and the suggested date).
Technical features are grouped into farmer-facing factors (recent prices, arrivals, seasonal
pattern, prices across Maharashtra, …). Each factor shows the **observed fact** (e.g. "prices
fell about 1 % over the past week") and whether the model associates it with a **higher** or
**lower** predicted price. These are patterns the model learned — **not proven causes**.

### Limitations specific to this feature
Mandi prices are hard to forecast: over all horizons the model is only about **2 % better on MAE
than "no change"**. Day 1 is never validated, and **onion is not validated at any horizon**.
See [section O](#o-model-training-and-evaluation) and MODEL_EVALUATION.md §1.

## G. Crop recommendation — how it works

Code: `backend/app/ml/crop_recommendation/recommender.py`, `app/ml/economics/profit.py`,
`app/ml/price_prediction/monthly_forecaster.py`, explanations in `app/ml/explainability/`.

### Objective
Rank the 7 supported crops for a specific field and season by **how well they suit the field,
whether they can be sold in the chosen month, and how profitable they are expected to be**.

### Inputs
| Input | Unit / range accepted by the API |
|---|---|
| Nitrogen, phosphorus, potassium | kg/ha (0–300, 0–300, 0–400) |
| Soil pH | 0–14 |
| Temperature, humidity, rainfall | °C, %, mm/month (growing-period averages) |
| City | one of 11 Maharashtra cities |
| Planting month, selling month | 1–12 |
| Field size | acres |
| Soil type | optional — stored only, **not used by the model** |

### How the ranking is produced
1. **Suitability (A)** — an **XGBoost classifier** trained on soil, weather, city, planting month,
   selling month and growing months gives a probability for each crop (×100).
2. **Timing (T)** — from `dataset/crop_recommendation/crop_season_calendar.csv`: is the planting
   month in the crop's window, and at the selling month is the crop harvest-ready, sellable from
   storage, not ready, or spoiled?
3. **Profit (P)** — the **XGBoost monthly price model** projects the crop's price in the user's
   city for the selling month; `profit.py` computes yield × (1 − losses) × price − cultivation,
   marketing and storage costs → net profit, ROI, break-even price and low/high scenarios.
   P = 50 + 50·tanh(ROI).
4. **Overall score = 0.40·A + 0.20·T + 0.40·P.** These weights are a documented design choice,
   not learned.
5. A crop is **recommended** only if the classifier gives it **≥ 5 %** probability **and** it can be
   sold in the chosen month. All 7 crops are returned ranked; **up to the top 3** eligible crops
   are shown as recommended (it can be fewer).

### What the numbers mean
- The **probability** is the classifier's class probability on a **synthetic** dataset. It says how
  closely the inputs match the generated examples for that crop — **not** the chance that the
  crop will succeed in a real field.
- **Profit figures** use approximate reference yields and costs (`crop_economics.csv`) and a
  long-range price projection; they are scenarios, not promises.
- The "Why this recommendation?" panel shows classifier SHAP contributions grouped into soil,
  weather, timing and location, plus the price-forecast factors. Inputs outside a crop's typical
  training range are listed as limitations.

## H. Datasets and data sources

| File | Used for | Origin |
|---|---|---|
| `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv` (246,067 rows, 2023-01-01 → 2025-12-31) | Daily and monthly price models | Provided by the project team. Column layout matches Government of India **AGMARKNET** mandi reports. **Exact source and licence: requires confirmation.** |
| `dataset/crop_recommendation/maharashtra_crop_recommendation.csv` (4,550 rows) | Crop classifier | **Synthetic**, generated by `backend/scripts/generate_crop_dataset.py` (seed 42) from agronomic reference ranges, city climate normals and crop calendars |
| `dataset/crop_recommendation/crop_season_calendar.csv`, `crop_economics.csv`, `city_climate_normals.csv`, `city_market_map.csv` | Timing, profit, data generation, city→market mapping | Hand-built reference tables; values are approximate (see DATASET.md §3) |
| `dataset/processed/*` | Cleaned rows, daily panel, monthly city panel, seasonal index | Generated by the scripts |
| `dataset/raw/Crop_recommendation.csv`, `dataset/raw/legacy/*` | **Not used** (earlier 22-crop dataset, kept for reference) | Public 22-crop dataset. **Source and licence: requires confirmation.** |

Price CSV columns: `Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price,
Modal_Price` (prices in ₹/quintal). To refresh data, add newer files with the same columns to
`dataset/raw/` and re-run the pipeline ([section O](#o-model-training-and-evaluation)).

All datasets and trained models needed to run the app are **included in the repository**; nothing
has to be downloaded separately. Full profiles and preprocessing decisions: [DATASET.md](DATASET.md).

## I. Project structure

```text
SmartCrop-AI/
├── README.md, ARCHITECTURE.md, DATASET.md, MODEL_EVALUATION.md
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── main.py                FastAPI app: CORS, routers, model loading at startup, /api/health
│   │   ├── config/settings.py     settings from environment / backend/.env
│   │   ├── auth/                  JWT, bcrypt, current-user dependency
│   │   ├── database/              SQLAlchemy engine/session and Base
│   │   ├── models/                ORM tables (users, predictions, recommendations, model versions)
│   │   ├── schemas/               Pydantic request/response models
│   │   ├── routes/                auth, price_prediction, crop_recommendation, history
│   │   ├── services/              business logic used by the routes
│   │   └── ml/
│   │       ├── price_prediction/  cleaning, features, daily + monthly forecasters, selling advice
│   │       ├── crop_recommendation/  classifier wrapper and scoring
│   │       ├── economics/         profit engine
│   │       ├── explainability/    SHAP → plain-language factors
│   │       ├── common/            paths, season conventions
│   │       └── registry.py        loads all models once
│   ├── alembic/ , alembic.ini     database migrations (0001 initial, 0002 economic recommendation)
│   ├── scripts/                   data preparation, dataset generation, training, sensitivity
│   ├── trained_models/            .joblib models + metadata.json + CV metrics
│   ├── tests/                     pytest suite
│   ├── requirements.txt
│   └── .env.example               configuration template (copy to .env)
├── frontend/
│   ├── src/
│   │   ├── pages/                 Dashboard, PricePrediction, PriceResult, CropRecommendation,
│   │   │                          CropResult, History, Profile, Login, Register, NotFound
│   │   ├── components/            shared UI (+ charts/ with Recharts)
│   │   ├── layouts/               sidebar app layout, auth layout
│   │   ├── services/              Axios instance and API wrappers
│   │   ├── context/, hooks/, utils/
│   │   └── index.css              design system
│   ├── package.json, vite.config.js, tailwind.config.js
│   └── .env.example
└── dataset/
    ├── raw/                       source CSVs (never edited)
    ├── processed/                 generated panels (parquet/CSV)
    ├── crop_price/                supported_series.csv
    ├── crop_recommendation/       synthetic crop dataset + reference tables
    └── reports/                   data-quality report, dataset summary, training log
```

## J. Installation and setup (Windows)

### 1. Prerequisites

| Tool | Version used in development |
|---|---|
| Python | 3.13 (3.11+ should work, not tested) |
| Node.js | 20.x (with npm) |
| MySQL Community Server | 8.0 |
| Git, VS Code | any recent version |

### 2. Clone and open the project

```powershell
git clone https://github.com/<organization>/SmartCrop-AI.git
cd SmartCrop-AI
code .
```

Replace `<organization>` with the GitHub organization that hosts the repository.

### 3. Create the MySQL database

Open the MySQL client (`mysql -u root -p`) or MySQL Workbench and run — choose your own password:

```sql
CREATE DATABASE smartcrop_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartcrop_user'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON smartcrop_ai.* TO 'smartcrop_user'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Backend (terminal 1)

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `backend\.env`: set `DATABASE_URL` to your database user/password and replace
`JWT_SECRET_KEY` with your own random value:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

URL-encode special characters in the password inside `DATABASE_URL` (`@` → `%40`). Then create
the tables:

```powershell
alembic upgrade head
```

### 5. Models and data

The trained models (`backend/trained_models/`) and processed panels (`dataset/processed/`) are
included, so **no training is needed** to run the app. To rebuild them, see
[section O](#o-model-training-and-evaluation).

### 6. Frontend (terminal 2)

```powershell
cd frontend
npm install
copy .env.example .env
```

`VITE_API_URL` defaults to `http://localhost:8000`; change it only if the backend runs elsewhere.

## K. Running the project

The backend and frontend run in **two separate terminals**.

**Terminal 1 — backend** (from `backend/`, virtual environment active):

```powershell
venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend** (from `frontend/`):

```powershell
npm run dev
```

Open **http://localhost:5173**, register an account and start with the dashboard.

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:8000/docs | Interactive API documentation (Swagger UI) |
| http://localhost:8000/redoc | Alternative API documentation |
| http://localhost:8000/api/health | Health check — shows whether each model loaded |

Stop either service with **Ctrl + C** in its terminal. There is no single root-level command that
starts both services yet.

## L. Environment variables

Templates: [`backend/.env.example`](backend/.env.example), [`frontend/.env.example`](frontend/.env.example).
Copy each to `.env` in the same folder; `.env` files are git-ignored.

| Variable | Purpose | Required | Safe example | Where |
|---|---|---|---|---|
| `DATABASE_URL` | SQLAlchemy URL of the MySQL database | **Yes** | `mysql+pymysql://your_db_user:your_db_password@localhost:3306/smartcrop_ai` | `backend/.env` |
| `JWT_SECRET_KEY` | Secret that signs login tokens (≥ 32 chars) | **Yes** | output of `python -c "import secrets; print(secrets.token_urlsafe(48))"` | `backend/.env` |
| `JWT_ALGORITHM` | Token signing algorithm | No (`HS256`) | `HS256` | `backend/.env` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime (1–1440) | No (`60`) | `60` | `backend/.env` |
| `CORS_ORIGINS` | Allowed frontend origins, as a **JSON list** | No (`["http://localhost:5173","http://127.0.0.1:5173"]`) | `["http://localhost:5173"]` | `backend/.env` |
| `ENVIRONMENT` | Label for the running environment | No (`development`) | `development` | `backend/.env` |
| `DATASET_DIR` | Override dataset folder | No (`../dataset`) | — | backend environment |
| `MODELS_DIR` | Override trained-model folder | No (`backend/trained_models`) | — | backend environment |
| `TEST_DATABASE_URL` | Run tests against an empty MySQL test DB instead of SQLite | No (tests only) | `mysql+pymysql://user:pass@localhost:3306/smartcrop_ai_test` | test shell |
| `VITE_API_URL` | Backend base URL used by the frontend | No (`http://localhost:8000`) | `http://localhost:8000` | `frontend/.env` |

## M. API reference

Base URL: `http://localhost:8000`. All endpoints except register, login and health require
`Authorization: Bearer <access_token>`. Full schemas: http://localhost:8000/docs.

| Method | Path | Purpose | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create account → token + user | 201 |
| POST | `/api/auth/login` | Log in → token + user | 200 |
| GET | `/api/auth/me` | Current user | 200 |
| PUT | `/api/auth/me` | Update name / change password | 200 |
| GET | `/api/price-prediction/options` | Supported crops, markets, today, max horizon, validated days | 200 |
| POST | `/api/price-prediction/predict` | Daily forecast + selling advice, **saved to history** | 201 |
| POST | `/api/price-prediction/trend` | Same forecast, not saved (`as_of` re-opens a saved one) | 200 |
| POST | `/api/price-prediction/explain` | SHAP explanation for the target (and suggested) date | 200 |
| POST | `/api/price-prediction/monthly-forecast` | Monthly price path for a crop/city | 200 |
| GET | `/api/crop-recommendation/options` | Crops, cities, crop calendar, economics assumptions, input ranges | 200 |
| POST | `/api/crop-recommendation/recommend` | Rank all 7 crops, **saved to history** | 201 |
| POST | `/api/crop-recommendation/analyze` | Same ranking, not saved | 200 |
| POST | `/api/crop-recommendation/explain` | Classifier SHAP for one crop | 200 |
| GET | `/api/history/summary` | Totals + 5 most recent of each type | 200 |
| GET | `/api/history/price?limit=&offset=` | Own price predictions (paged) | 200 |
| GET / DELETE | `/api/history/price/{id}` | One own prediction | 200 / 204 |
| GET | `/api/history/recommendations?limit=&offset=` | Own recommendations (paged) | 200 |
| GET / DELETE | `/api/history/recommendations/{id}` | One own recommendation | 200 / 204 |
| GET | `/api/health` | Liveness + which models are loaded | 200 |

**Errors:** `401` missing/invalid/expired token or wrong login · `404` not found or not owned by you ·
`409` e-mail already registered · `422` invalid input, or a forecast that cannot be made honestly
(with a plain-language message) · `503` model not loaded · `500` unexpected (logged, generic message).

### Example — price forecast

```http
POST /api/price-prediction/trend
Authorization: Bearer <access_token>
Content-Type: application/json

{ "state": "Maharashtra", "market": "All markets (state median)", "commodity": "Onion",
  "target_date": "2026-10-25" }
```

Response (abridged from a real local run on 2026-10-11; `path` holds one entry per day):

```json
{
  "series": { "state": "Maharashtra", "market": "All markets (state median)",
              "commodity": "Onion", "variety": "All varieties" },
  "input_date": "2026-10-11", "target_date": "2026-10-25", "current_price": 997.5,
  "target": { "horizon_days": 14, "date": "2026-10-25", "predicted_price": 1066.76,
              "lower": 788.54, "upper": 1347.53, "change_pct": 6.94, "direction": "Stable",
              "beats_baseline": false, "model_mae": 250.9, "baseline_mae": 227.5 },
  "path": [ { "horizon_days": 1, "date": "2026-10-12", "predicted_price": 1006.49,
              "lower": 875.97, "upper": 1124.54, "beats_baseline": false } ],
  "advice": { "code": "UNCERTAIN", "label": "Forecast too uncertain to pick an exact date",
              "recommended_date": "2026-10-25", "extra_per_quintal": 0.0, "wait_days": 0 },
  "projection": { "reference_origin_date": "2025-10-11", "inflation_annual_pct": 5.0 },
  "model": { "approach": "direct multi-horizon (horizon is a feature), no recursion",
             "data_end": "2025-12-31" }
}
```

A target date more than 60 days ahead returns `422` with a message such as
*"The model forecasts at most 60 days after the last reported price … Choose a target date on or
before …"*.

### Example — crop recommendation

```http
POST /api/crop-recommendation/analyze
Authorization: Bearer <access_token>
Content-Type: application/json

{ "nitrogen": 80, "phosphorus": 45, "potassium": 85, "temperature": 23, "humidity": 58,
  "ph": 6.8, "rainfall": 70, "state": "Maharashtra", "city": "Nashik",
  "planting_month": 11, "selling_month": 3, "area_acres": 1 }
```

Response (abridged; `results` contains all 7 crops):

```json
{
  "city": "Nashik", "planting_date": "2026-11", "selling_date": "2027-03",
  "growing_months": 4, "area_acres": 1.0,
  "weights": { "agronomic": 0.4, "timing": 0.2, "profit": 0.4 },
  "results": [
    { "rank": 1, "crop_name": "Onion", "recommended": true, "probability": 0.998,
      "recommendation_score": 84.35, "agronomic_score": 99.78, "timing_score": 100.0,
      "profit_score": 61.1,
      "economics": { "selling_price": 1105.45, "price_low": 605.01, "price_high": 1547.4,
                     "gross_revenue": 101701.0, "total_cost": 84294.0, "net_profit": 17407.0 } }
  ]
}
```

## N. Example workflows

**Predict a crop price and pick a selling date**
1. Dashboard → **Crop Price Prediction**.
2. Choose crop, market (the state median is the most reliable) and the date you plan to sell.
3. The result page shows the predicted price and range for your date, the daily forecast chart,
   the **Best time to sell** card (with optional storage-cost calculator), "Why is this price
   predicted?" and how reliable the forecast is for that crop and horizon.
4. To compare selling dates, read the chart and the advice card: later validated dates within the
   crop's storage limit are already compared for you.

**Find the most profitable crop**
1. Dashboard → **Profitable Crop Recommendation** (or try one of the example fields on the form).
2. Enter soil and weather values, city, planting and selling months and field size.
3. The result shows up to three recommended crops, a profit/revenue chart for all 7, the projected
   price trend, a profit breakdown, a growth timeline and "Why this recommendation?".

**Review history**
- **History** shows the totals and paged tables of saved forecasts and recommendations; open any
  record to rebuild its result page, or delete it.

## O. Model training and evaluation

Run from `backend/` with the virtual environment active. Training takes roughly 20–25 minutes on a
laptop (most of it the daily price model). Outputs go to `backend/trained_models/` and
`dataset/processed/`; restart the API afterwards.

```powershell
python -m scripts.prepare_price_data          # clean data, quality report, daily panel
python -m scripts.train_price_model           # daily price forecaster (CV + final fit)
python -m scripts.train_monthly_price_model   # monthly selling-month price model
python -m scripts.generate_crop_dataset       # synthetic 7-crop dataset (deterministic)
python -m scripts.train_recommendation_model  # crop classifier
python -m scripts.score_sensitivity           # optional: score-weight sensitivity report
```

### Recorded results
From the metadata saved with the committed models (full tables and method in
[MODEL_EVALUATION.md](MODEL_EVALUATION.md)):

| Model | Validation | Result |
|---|---|---|
| Daily price, all horizons 1–60 | 4-fold expanding-window CV over the quarters of 2025 | MAE ₹400/qtl vs ₹406.5 for "no change"; RMSE ₹669 vs ₹710; MAPE 24.1 % |
| Daily price, 7 days ahead | same | MAE ₹266 vs ₹278 "no change" |
| Daily price, 30 days ahead | same | MAE ₹434 vs **₹427 "no change"** (not better) |
| Monthly price (XGBoost) | time-ordered out-of-sample CV | MAE ₹616/qtl vs ₹750 "no change" and ₹630 seasonal naive; MAPE 45 % |
| Crop classifier (XGBoost) | stratified 80/20 hold-out (910 rows), 5-fold CV on the training part | accuracy 0.851, macro-F1 0.850 — **on synthetic data** |

> MODEL_EVALUATION.md names daily price model version `202610101837`, while the committed
> `metadata.json` says `202610101847`; the recorded metrics are identical. **Version label requires
> confirmation.**

## P. Testing and troubleshooting

### Automated tests

```powershell
cd backend
venv\Scripts\activate
python -m pytest
```

47 tests (all passing at the time of writing). They use a temporary SQLite database by default, so
MySQL is not needed. To test against MySQL, point `TEST_DATABASE_URL` at an **empty** test database.
Covered: registration/login/JWT (expired and forged tokens), password hashing, protected endpoints,
price prediction/trend/explain, SHAP additivity, crop recommendation and scoring, users cannot read
or delete each other's history, pagination, migrations match the ORM, feature leakage, preprocessing
rules and the best-time-to-sell rules.

Frontend: there are no automated frontend tests; `npm run build` must succeed.

### Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ModuleNotFoundError` when starting the backend | Virtual environment not active, or `pip install -r requirements.txt` not run. |
| Backend exits with a validation error about `DATABASE_URL` or `JWT_SECRET_KEY` | `backend/.env` missing, or the secret is shorter than 32 characters. |
| `Can't connect to MySQL server` / `Access denied` | MySQL service (`MySQL80`) not running, wrong user/password, or an un-encoded `@` in the password. |
| `Table … doesn't exist` | Run `alembic upgrade head` in `backend/`. |
| API returns **503** / `/api/health` shows a model `false` | A file in `backend/trained_models/` or `dataset/processed/` is missing — restore it or re-run the scripts in section O. |
| Frontend shows "Cannot reach the SmartCrop server" | Backend not running on port 8000, or `VITE_API_URL` points elsewhere. |
| Browser console shows a CORS error | Add the frontend's exact origin to the `CORS_ORIGINS` JSON list and restart the backend. |
| Backend fails with `error parsing value for field "CORS_ORIGINS"` | Write `CORS_ORIGINS` as a JSON list, e.g. `["http://localhost:5173"]`, not comma-separated. |
| `Port 5173 is in use` / `address already in use` on 8000 | Another dev server is still running — close it, or start on another port and update `CORS_ORIGINS` / `VITE_API_URL`. |
| `npm` errors about missing packages | Run `npm install` in `frontend/`. |
| A price request returns **422** | Expected for dates more than 60 days ahead or unsupported market series; the message explains why. |

## Q. Security and privacy

- **Never commit `.env` files.** Both `.env` files are git-ignored; only the `.env.example`
  templates (placeholders only) are tracked.
- Keep database passwords and the JWT secret private; generate a unique `JWT_SECRET_KEY` for every
  environment. Changing it logs every user out, which is the right response if it ever leaks.
- If a credential is ever committed or shared, **rotate it** (change the MySQL password, generate a
  new JWT secret) — deleting it in a later commit does not remove it from Git history.
- Passwords are stored only as bcrypt hashes; tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES`.
- Every history query is filtered by the logged-in user; another user's record returns 404.
- Do not paste real tokens, passwords or personal data into issues, logs or screenshots.

## R. Limitations

- **Coverage:** 7 crops, Maharashtra only, mandi data from 2023-01-01 to 2025-12-31. Forecasts from
  today are **seasonal projections** based on the same date in 2025 plus an assumed 5 %/year inflation.
- **Daily price forecasts** are only modestly better than "no change" (~2 % on MAE overall); day 1 is
  never validated and **onion is not validated at any horizon**. Treat forecasts as estimates, not
  future market prices.
- **Selling-month (monthly) prices** are long-range projections with large errors (MAPE ≈ 45 %).
- **The crop dataset is synthetic.** The classifier's 85 % accuracy measures how separable the
  generated data is, not field accuracy. Recommendations are model outputs, **not agronomic advice**.
- Yields, costs, storage limits and climate normals are **approximate reference values**.
- Soil type and live weather are not used by the models; the 40/20/40 score weights are a design
  choice, not learned.
- Market behaviour and agricultural conditions change; models need retraining on newer data.

## S. Future improvements

*Planned or possible work — not implemented:*

- Add 2026+ AGMARKNET data and automate data refresh and retraining.
- Replace the synthetic crop dataset with surveyed farm records; let farmers enter their own yield
  and cost figures.
- Live weather (e.g. IMD) and district-level soil data.
- Calibrated uncertainty (quantile or conformal models) and storage-cost-aware selling advice.
- Frontend automated tests, CI, a single command to start both services, and deployment.
- Refresh tokens, rate limiting, account deletion; Marathi/Hindi interface.

## T. Contributors

| Name | GitHub |
|---|---|
| Vaishnavi Pawar | [@vaishnavipawar26](https://github.com/vaishnavipawar26) |
| Shruti Temgire | [@shruti-temgire](https://github.com/shruti-temgire) |

*Individual contribution details: to be added by the team.*

## U. Contributing

1. **Clone** the repository and set it up as in [section J](#j-installation-and-setup-windows).
2. **Create a branch** from an up-to-date `main`:
   ```powershell
   git checkout main
   git pull
   git checkout -b feature/short-description   # or fix/short-description, docs/…
   ```
3. **Make your changes**, keeping them focused on one topic.
4. **Check them:** `python -m pytest` in `backend/`, `npm run build` in `frontend/`, and try the
   affected pages in the browser.
5. **Commit** with a clear message — and make sure no `.env`, credentials or personal data are staged
   (`git status`, `git diff --staged`).
6. **Push** the branch: `git push -u origin feature/short-description`.
7. **Open a pull request** into `main` on GitHub describing what changed and how it was tested.
8. **Review and merge:** important changes should be reviewed by the other owner before merging.
   Retrained models should include the updated `metadata.json` and a note on how metrics changed.

## V. License

**No license has been chosen yet.** Until a license file is added, the code is under exclusive
copyright of its authors and others may not reuse it. The project owners will choose a license
(for example MIT, Apache-2.0 or GPL-3.0) before making the repository public. Note that the datasets
may carry their own terms (see [section H](#h-datasets-and-data-sources)).

## W. Acknowledgements and references

- Mandi price data layout: Government of India **AGMARKNET** — https://agmarknet.gov.in/ and the
  Open Government Data Platform — https://data.gov.in/ (exact dataset source: requires confirmation).
- [FastAPI](https://fastapi.tiangolo.com/) · [SQLAlchemy](https://www.sqlalchemy.org/) ·
  [Alembic](https://alembic.sqlalchemy.org/) · [Pydantic](https://docs.pydantic.dev/)
- [scikit-learn](https://scikit-learn.org/) · [XGBoost](https://xgboost.readthedocs.io/) ·
  [SHAP](https://shap.readthedocs.io/) · [pandas](https://pandas.pydata.org/)
- [React](https://react.dev/) · [Vite](https://vite.dev/) · [Recharts](https://recharts.org/) ·
  [Tailwind CSS](https://tailwindcss.com/) · [Lucide](https://lucide.dev/)
