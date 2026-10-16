# SmartCrop AI

**A web application that helps Maharashtra farmers choose which crop to grow and when to sell it, using machine learning, live weather data and explanations they can read.**

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.141.1-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5.4.11-646CFF?logo=vite&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-3.4.1-EC6B23)
![scikit-learn](https://img.shields.io/badge/scikit--learn-1.8.0-F7931E?logo=scikitlearn&logoColor=white)
![SHAP](https://img.shields.io/badge/SHAP-0.52.0-8A2BE2)
![Open-Meteo](https://img.shields.io/badge/Weather-Open--Meteo-2E8B57)

> **Status:** academic major project and working prototype. Every forecast and recommendation is a
> model-based estimate, not a guarantee. See [section 15](#15-limitations-and-future-scope).

---

## Table of contents

1. [Project summary](#1-project-summary)
2. [Introduction and problem statement](#2-introduction-and-problem-statement)
3. [Objectives and scope](#3-objectives-and-scope)
4. [Key features](#4-key-features)
5. [Technology stack](#5-technology-stack)
6. [Datasets](#6-datasets)
7. [How it works](#7-how-it-works)
8. [Machine learning details](#8-machine-learning-details)
9. [Diagrams](#9-diagrams)
10. [API reference](#10-api-reference)
11. [Project structure](#11-project-structure)
12. [Installation and setup](#12-installation-and-setup)
13. [How to use](#13-how-to-use)
14. [Testing](#14-testing)
15. [Limitations and future scope](#15-limitations-and-future-scope)
16. [Black book reference guide](#16-black-book-reference-guide)
17. [References, data sources and license](#17-references-data-sources-and-license)
18. [Glossary](#glossary)

More detail lives in three companion files: [ARCHITECTURE.md](ARCHITECTURE.md) (database schema,
authentication, full ML pipeline, SHAP), [DATASET.md](DATASET.md) (data profiles and cleaning) and
[MODEL_EVALUATION.md](MODEL_EVALUATION.md) (validation method and every measured metric).

---

## 1. Project summary

| Item | Value |
|---|---|
| Name | SmartCrop AI |
| Type | Full-stack web application (React frontend, FastAPI backend, MySQL database, ML models) |
| Region | Maharashtra, India |
| Crops | 7: Brinjal, Cabbage, Cauliflower, Onion, Potato, Tomato, Wheat |
| Cities supported by the crop model | 11: Ahilyanagar, Amravati, Chhatrapati Sambhajinagar, Jalgaon, Kolhapur, Mumbai, Nagpur, Nashik, Pune, Satara, Solapur |
| Two main tools | **Compare crops for my field** (crop recommendation) and **Crop price prediction** |
| Interface languages | English, Marathi, Hindi |
| Mandi price data | 2023-01-01 to 2025-12-31 (246,067 rows) |
| Backend tests | 83 (pytest) |

---

## 2. Introduction and problem statement

### The problem

A farmer has to make two difficult decisions:

1. **Which crop should I plant?** The best crop depends on the soil (nitrogen, phosphorus, potassium
   and pH), the weather while the crop grows, the place, and the month the crop can be sold.
2. **When should I sell?** Mandi (wholesale market) prices change from week to week and from season
   to season. Most farmers only know today's price. They cannot easily tell whether waiting a month
   will earn more or less, or whether the crop will even be ready, or will spoil, by then.

Advice from a general website is often not specific to the farmer's own field, and it rarely explains
its reasons.

### What this project does

SmartCrop AI lets the farmer enter their soil test results, choose their place, planting month and
selling month, and fetch the weather for that place automatically. The system then compares all
seven supported crops for that field. For each crop it checks how well the soil and weather suit it,
whether the crop can be harvested and sold in the chosen month, and what profit to expect. It shows
the best crop first, with the reasons. A second tool forecasts the daily mandi price of a crop and
suggests a better day to sell. Both tools explain their results in plain language using SHAP, a
method that shows which inputs pushed a prediction up or down.

---

## 3. Objectives and scope

### Objectives

- Help a farmer compare crops for a specific field, planting month and selling month.
- Estimate the price a crop may fetch in the selling month and the expected profit.
- Fetch the growing-period weather automatically, with a manual fallback.
- Forecast daily mandi prices and suggest a better day to sell.
- Explain every prediction in simple words.
- Keep a history of each user's results.

### In scope

- 7 crops, Maharashtra, 11 cities for crop comparison.
- Soil values entered by the farmer (N, P, K, pH).
- Weather from Open-Meteo (3-year average for the growing months).
- Price forecasts based on 2023-2025 mandi prices.
- User accounts (register, log in, history).

### Out of scope

- It does not give agronomic or financial advice. Results are estimates.
- It does not measure the soil. The farmer must bring a soil test report.
- It does not use live news, government policy, pests, disease or real-time market events.
- It does not cover states other than Maharashtra or crops other than the seven listed.
- Soil type (Black cotton, Red and so on) is stored with the result but the model does not use it.

---

## 4. Key features

| Feature | What the user sees |
|---|---|
| **Soil test results** | Four fields: Nitrogen (N), Phosphorus (P), Potassium (K) and Soil pH. Each shows its unit, the usual range from the data, and a small range bar. A value outside the data limits is blocked; a value few crops grow well at gets an amber hint. |
| **Place, dates and field** | State (fixed to Maharashtra), a searchable City / nearest mandi list, planting month, selling month, a duration badge ("4 months from planting to selling") with a month timeline, field size in acres (with the acre-to-guntha conversion) and an optional soil type. |
| **Automatic weather by city** | Once city, planting month and selling month are set, the form loads average temperature, humidity and rainfall for the growing months from Open-Meteo. |
| **Edit manually fallback** | If the weather cannot be loaded, or the farmer prefers their own numbers, "Edit manually" turns the three weather cards into normal inputs. Nobody is blocked. |
| **Likely good fits preview** | As soon as the soil and weather values are valid, a small preview lists the crops whose usual ranges match. Final results come after submit. |
| **Compare crops for my field** | All 7 crops are ranked on soil and weather match, timing and expected profit. Up to 3 are marked recommended. |
| **Harvest readiness** | Each crop is shown as *ready in time* (green), *sell from storage* (amber) or *not ready / would spoil* (red) for the chosen months. |
| **Best time to sell** | On the result page, the month with the highest projected price inside the sellable window, compared with the farmer's own month. |
| **Price prediction** | A separate tool forecasts the daily mandi price (₹ per quintal) for a crop and market up to 60 days ahead, with a likely range and a best-day suggestion. |
| **"Why did the model predict this price?"** | A plain-language explanation of the main factors behind a price, based on SHAP. |
| **History and accounts** | Register, log in, view and delete saved predictions and recommendations. Users see only their own records. |
| **Languages** | English, Marathi and Hindi. |

---

## 5. Technology stack

Versions are copied from [`backend/requirements.txt`](backend/requirements.txt) and
[`frontend/package.json`](frontend/package.json).

| Layer | Technology | Version | Why it is used |
|---|---|---|---|
| Frontend | React | 18.3.1 | Builds the single-page user interface |
| | Vite | 5.4.11 | Fast development server and production build |
| | React Router | 6.28.0 | Pages and protected routes |
| | Axios | 1.7.9 | API calls; attaches the login token |
| | Recharts | 2.15.0 | Price, profit and SHAP charts |
| | Tailwind CSS | 3.4.17 | Utility classes next to the app's own CSS (`src/index.css`) |
| | lucide-react | 0.468.0 | Icons |
| Backend | Python | 3.13 (used in development) | Language of the API and ML code |
| | FastAPI | 0.141.1 | REST API with automatic documentation |
| | Uvicorn | 0.52.4 | Web server for FastAPI |
| | Pydantic / pydantic-settings | 2.13.5 / 2.15.0 | Checks request data and loads `.env` settings |
| | httpx | 0.28.1 | Calls the Open-Meteo APIs; also used by the test client |
| Database | MySQL | 8 | Users, saved results, model versions |
| | SQLAlchemy | >= 2.0.36, < 2.1 | Object-relational mapper |
| | Alembic | >= 1.14, < 2 | Database migrations |
| | PyMySQL | >= 1.1.1, < 2 | MySQL driver |
| Security | PyJWT | >= 2.10, < 3 | Login tokens (HS256) |
| | bcrypt | 5.0.0 | Password hashing |
| Machine learning | pandas / NumPy | 3.0.0 / 2.4.2 | Data cleaning and features |
| | scikit-learn | 1.8.0 | Random Forest price model and baselines |
| | XGBoost | 3.4.1 | Crop classifier, monthly price model, short-range daily prices |
| | joblib | 1.5.3 | Saving and loading trained models |
| | PyArrow | 21.0.0 | Parquet data panels |
| | matplotlib | 3.10.8 | Confusion-matrix image during training |
| Explainability | SHAP (`TreeExplainer`) | 0.52.0 | Shows which inputs raised or lowered a prediction |
| Weather API | Open-Meteo Geocoding and Historical Archive | no key | Free weather data |
| Caching | In-memory dictionary in `weather_service.py` | n/a | Keeps weather results for 24 hours |
| Testing | pytest | >= 8.3, < 9 | 83 backend tests |
| Tools | Git, VS Code, MySQL Workbench (optional) | any recent | Development |

---

## 6. Datasets

### 6.1 Mandi price data (Agmarknet)

- **What Agmarknet is.** Agmarknet (https://agmarknet.gov.in) is the Government of India's
  agricultural marketing information portal. It publishes daily arrivals and prices from the
  country's APMC mandis (regulated wholesale markets).
- **Source of the price files.** According to the project team, the price data comes from Agmarknet.
  The raw file in this repository is `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv`.
  TODO: confirm the exact download route and licence terms.
- **What the data contains.** One row per market, crop, variety and day.

  | Column | Meaning |
  |---|---|
  | `Date` | Day of the report |
  | `State` | Always Maharashtra |
  | `Market` | Name of the mandi, for example `APMC Pune` |
  | `Commodity` | One of the 7 crops |
  | `Variety` | Variety name (often `Other`) |
  | `Arrivals` | Quantity brought to the market |
  | `Min_Price`, `Max_Price` | Lowest and highest price, ₹ per quintal |
  | `Modal_Price` | The most common price, ₹ per quintal. This is the value the models predict. |

- **Size and range (read from the file).** 246,067 rows, from 2023-01-01 to 2025-12-31, 7 crops,
  297 markets.
- **`supported_series.csv`.** `dataset/crop_price/supported_series.csv` lists every
  (market, crop, variety) series with its number of observations, first and last date and coverage,
  and a `supported` flag. It has 767 rows; 427 are `supported = True` (enough history to forecast).
  The file is produced by `backend/scripts/prepare_price_data.py` from the Agmarknet-based raw file.
  The app only offers supported series.
- **Cleaning** (`app/ml/price_prediction/preprocessing.py`, logged in
  `dataset/reports/price_data_quality.md`):
  1. Same-day duplicates are merged (median price, average arrivals).
  2. Isolated outliers are capped using a rule that only looks backwards in time.
  3. Prices of zero or below are set to missing.
  4. Each series is placed on a continuous daily calendar and prices are carried forward at most 7 days.
  5. A state-median series is added for each crop ("All markets (state median)").
- **Features** (`app/ml/price_prediction/features.py`): recent price changes (1, 3, 7, 14, 30 days),
  rolling averages and volatility, arrivals, the gap to the state median, calendar features (month,
  week, weekday, season, day of year) and the number of days ahead. The monthly model uses monthly
  medians, momentum, level against the 3 and 12 month averages, volatility, arrivals, a city
  premium and seasonal priors. See [section 8](#8-machine-learning-details).

### 6.2 Soil and crop-weather recommendation dataset (created by the team)

- **Not downloaded.** This dataset was created by the project team, not taken from a public
  source. The file is `dataset/crop_recommendation/maharashtra_crop_recommendation.csv`.
- **How it was built.** The team wrote down, for each of the 7 crops, the usual ranges of nitrogen,
  phosphorus, potassium, pH, temperature, humidity and rainfall, the planting months and the
  growth period, using agricultural reference values (for example ICAR and state agricultural
  university guides). The script `backend/scripts/generate_crop_dataset.py` (random seed 42) then
  generates example rows inside those ranges, using the city climate table and crop calendar.
  TODO: confirm the exact reference documents used for each crop.
- **Size.** 4,550 rows, 650 per crop, 7 crops.
- **Columns.** `N`, `P`, `K`, `temperature`, `humidity`, `ph`, `rainfall`, `state`, `city`,
  `planting_month`, `selling_month`, `label` (the crop name).
- **Supporting tables** (hand-written, in the same folder):

  | File | Rows | Columns |
  |---|---|---|
  | `crop_season_calendar.csv` | 7 | crop, planting_months, growth_months_min, growth_months_max, max_storage_months, storable, source, notes |
  | `crop_economics.csv` | 7 | crop, yield_q_per_acre, cost_per_acre_inr, cost_reference_year, post_harvest_loss_pct, storage_loss_pct_per_month, storage_cost_per_q_month, marketing_cost_pct, verification_status |
  | `city_climate_normals.csv` | 132 | city, month, temperature_c, humidity_pct, rainfall_mm |
  | `city_market_map.csv` | 64 | city, market |
  | `city_coordinates.csv` | 13 | state, city, latitude, longitude |

- **Limitations.** The dataset is small, was generated rather than measured on real farms, and is an
  estimate. The classifier's accuracy (about 85 %) tells how well it separates this generated data,
  not how well it predicts real fields. Yields, costs and storage limits are approximate.

### 6.3 Weather data (Open-Meteo)

- Fetched live by `backend/app/services/weather_service.py`. No API key is needed.
- **Geocoding API** (`geocoding-api.open-meteo.com`) finds a place only when its coordinates are not
  stored in `city_coordinates.csv`.
- **Historical Archive API** (`archive-api.open-meteo.com/v1/archive`) gives daily mean temperature,
  mean relative humidity and total precipitation for the last 3 full calendar years.
- For the months from planting to selling (both included) the service returns the mean temperature,
  the mean humidity and the rainfall per month (daily rain summed per month, then averaged over
  months and years).

### 6.4 All datasets at a glance

| Name | Source | How obtained | Used for | File path |
|---|---|---|---|---|
| Mandi prices 2023-2025 | Agmarknet (per the team; TODO: confirm exact route) | Downloaded and supplied by the team | Daily and monthly price models | `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv` |
| Supported series | Derived from the price file | `prepare_price_data.py` | Which market series can be forecast | `dataset/crop_price/supported_series.csv` |
| Processed price panels | Derived | `prepare_price_data.py` | Model features | `dataset/processed/` |
| Crop recommendation dataset | Created by the team | `generate_crop_dataset.py` | Crop classifier | `dataset/crop_recommendation/maharashtra_crop_recommendation.csv` |
| Crop calendar and economics | Created by the team from references | Written by hand | Timing and profit | `dataset/crop_recommendation/crop_season_calendar.csv`, `crop_economics.csv` |
| City climate and market tables | Created by the team | Written by hand | Dataset generation, city-to-market mapping | `dataset/crop_recommendation/city_climate_normals.csv`, `city_market_map.csv` |
| City coordinates | Public map coordinates entered by the team | Written by hand | Weather lookup without geocoding | `dataset/crop_recommendation/city_coordinates.csv` |
| Weather | Open-Meteo APIs | Live request, cached 24 hours | Temperature, humidity, rainfall | Not stored on disk |
| 22-crop dataset and legacy tables | Public dataset (source: TODO: confirm) | Earlier version | **Not used**; kept for reference | `dataset/raw/Crop_recommendation.csv`, `dataset/raw/legacy/` |

All datasets and trained models needed to run the app are in the repository. Nothing has to be
downloaded to run it. Full data profiles: [DATASET.md](DATASET.md).

---

## 7. How it works

**Compare crops for my field**, step by step:

1. The farmer logs in and opens **Compare crops for my field**.
2. **Step 1, Soil test results:** the farmer types N, P, K and pH from the soil test report.
3. **Step 2, Place, dates and field:** the farmer picks the city, planting month, selling month and
   field size.
4. **Step 3, Weather while the crop grows:** the form waits half a second, then asks the backend
   (`GET /api/weather`) for the 3-year average temperature, humidity and rainfall of the growing
   months. If it fails, the farmer can retry or choose **Edit manually**.
5. When all values are valid, the **Compare crops for my field** button is enabled. The page also
   shows a "Likely good fits" preview using the crops' usual ranges.
6. On submit, the frontend sends the values to `POST /api/crop-recommendation/recommend`.
7. The backend checks the input and the city. The **XGBoost classifier** gives each crop a match
   probability. The **crop calendar** says whether each crop is ready, sellable from storage, not
   ready or spoiled at the selling month. The **monthly price model** projects the crop's price in
   the selling month, and the **profit engine** turns that into revenue, cost, net profit and
   break-even price.
8. The three scores are combined: overall score = 0.40 x soil and weather match + 0.20 x timing +
   0.40 x profit.
9. **SHAP** explains the ranking. The backend saves the result to MySQL and returns all 7 crops.
10. The result page shows the best crop, a comparison, the **Best time to sell**, a price chart, the
    profit summary, the timeline and a "Why this recommendation?" panel.

**Crop price prediction** works the same way, but the farmer picks a crop, a market and a selling
date, and the daily model predicts the price for every day up to that date.

---

## 8. Machine learning details

### 8.1 Crop recommendation

| Item | Detail |
|---|---|
| Task | Classify which of 7 crops best matches the field |
| Algorithm | XGBoost classifier (`XGBClassifier`, 400 trees, depth 4, learning rate 0.08) |
| Input features | N, P, K, temperature, humidity, pH, rainfall, city code, planting month, selling month, growing months |
| Output | A probability for each crop |
| Training data | 4,550 generated rows (see 6.2) |
| Training steps | Stratified 80/20 split; 5-fold cross-validation on the training part; compared with logistic regression and random forest; XGBoost deployed |
| Metrics (hold-out, 910 rows) | accuracy 0.851, macro precision 0.851, macro recall 0.851, macro F1 0.850 |
| Important note | A logistic-regression baseline reaches a similar cross-validated accuracy (0.849), so the data is easy to separate. The metric is for generated data, not real fields. |
| Saved files | `backend/trained_models/crop_recommendation/` |

**Final ranking** (`app/ml/crop_recommendation/recommender.py`, `app/ml/economics/profit.py`):

- **Soil and weather match (A):** the classifier probability, also summarised as how many of the 7
  values lie inside the crop's usual range.
- **Timing (T):** from `crop_season_calendar.csv`.
- **Profit (P):** `yield x (1 - losses) x price - cultivation, marketing and storage costs`, turned
  into a score with `50 + 50 x tanh(ROI)`.
- **Overall = 0.40 A + 0.20 T + 0.40 P.** These weights are a design choice, not learned.
- A crop is **recommended** only if its probability is at least 5 % and it can be sold in the chosen
  month. Up to 3 crops are recommended.

### 8.2 Monthly price model (selling-month price)

| Item | Detail |
|---|---|
| Task | Project a crop's price in a city for the selling month, 1 to 24 months ahead |
| Algorithm | XGBoost regressor on real (inflation-adjusted) log price change |
| Features | horizon, origin month, target month, crop, city, 1 and 3 month momentum, level against 3 and 12 month averages, 6-month volatility, arrivals against 12-month average, city premium, seasonal price prior, seasonal arrivals prior |
| Validation | Two time-ordered cut-offs (2024-12 and 2025-06) with 6-month test windows |
| Result | MAE ₹616 per quintal against ₹750 for "no change" and ₹630 for a seasonal naive guess; MAPE about 45 % |
| Assumption | 5 % per year inflation is added back to turn real prices into rupee prices |
| Saved files | `backend/trained_models/monthly_price/` |

The range shown on the result page (likely low and high) comes from the model's out-of-fold errors.

### 8.3 Daily price prediction

| Item | Detail |
|---|---|
| Task | Predict the modal price for every day, 1 to 60 days ahead |
| Target | `log(price at day t+h / price at day t)` |
| Design | One direct multi-horizon model: the number of days ahead is a feature, and no predicted price is fed back as an input |
| Algorithms | Days 1-12: XGBoost; days 13-60: Random Forest (scikit-learn), chosen by cross-validation |
| Validation | 4-fold expanding-window cross-validation over the quarters of 2025 |
| Result (all horizons) | MAE ₹400 per quintal against ₹406.5 for "no change"; RMSE ₹669 against ₹710; MAPE 24.1 % |
| Honest note | The model is only about 2 % better than "no change" overall. At 30 days it is not better (₹434 against ₹427). Onion is not validated at any horizon. |
| Reliability flag | Every forecast day carries `beats_baseline`, which is true only if the model beat "no change" for that crop at that horizon in cross-validation. |
| Saved files | `backend/trained_models/price_prediction/` |

Full tables and method: [MODEL_EVALUATION.md](MODEL_EVALUATION.md).

### 8.4 How the explanation is produced and how to read it

The explainers are in `backend/app/ml/explainability/`.

1. `shap.TreeExplainer` runs on the deployed tree model for the single prediction being shown.
2. SHAP gives every input a value: how much it pushed the prediction up or down compared with the
   model's average.
3. The code groups technical inputs into a few farmer-friendly factors, and pairs each with an
   observed fact from the price history.

**How to read "Why did the model predict this price?"**

| Part | Meaning |
|---|---|
| **Starting price level** | Where the price is now, compared with its normal level. For example "the price was 10 % above its 12-month average". Prices tend to drift back towards normal (mean reversion). |
| **Seasonal trend** | What usually happens in the selling month, for example "November prices averaged 35 % above the yearly average". |
| **Usual pattern** | Market supply (arrivals), recent price movement, volatility, how many months away the selling month is, the city's market and the crop's own behaviour. |
| **Higher / lower / small influence** | Whether the factor supports a higher price, a lower price, or matters little (under 1 %). |

The text is worded as a pattern the model has learned ("the model links this to a higher price"),
**not** as a proven cause. For the monthly model: starting level + factors + inflation = forecast.

For the crop ranking, the "Why this recommendation?" panel groups SHAP values into soil, weather,
timing and location, and lists values outside a crop's usual (5th to 95th percentile) range as
limitations.

---

## 9. Diagrams

All diagrams use Mermaid and render on GitHub. They are based on the real files and endpoints in
this repository. Mermaid has no native use case or object diagram, so those two are drawn with
flowcharts and say so.

### 9.1 System architecture

```mermaid
flowchart LR
    U(["Farmer in browser"]) --> FE["React frontend<br/>Vite, port 5173"]
    FE -->|"JSON + Bearer token"| API["FastAPI backend<br/>port 8000"]
    API --> AUTH["Auth<br/>bcrypt and JWT"]
    API --> WX["weather_service.py"]
    WX --> CACHE[("In-memory cache<br/>24 hours")]
    WX -->|"HTTPS"| OM["Open-Meteo APIs"]
    WX --> COORD[["city_coordinates.csv"]]
    API --> REG["ModelRegistry<br/>loaded at startup"]
    REG --> CLS["Crop classifier<br/>XGBoost"]
    REG --> MON["Monthly price model<br/>XGBoost"]
    REG --> DAY["Daily price model<br/>XGBoost + Random Forest"]
    CLS --> EXP["Explainability<br/>SHAP"]
    MON --> EXP
    DAY --> EXP
    API --> PROFIT["Profit and timing engine"]
    PROFIT --> TAB[["Crop calendar and economics CSVs"]]
    MON --> AG[["Agmarknet price data<br/>supported_series"]]
    DAY --> AG
    CLS --> MAN[["Manual soil and weather dataset"]]
    API <--> DB[("MySQL<br/>users, history, model versions")]
    API -->|"result + explanation"| FE
```

*Figure 1. The browser talks only to the FastAPI backend. The backend fetches weather, runs the
models and the explainer, and stores history in MySQL.*
The models and datasets are loaded once when the server starts. Weather is the only live external
call during a request, and it is cached for 24 hours.

### 9.2 Use case diagram (drawn as a flowchart)

```mermaid
flowchart LR
    F(["Farmer"])
    OMA(["Open-Meteo API"])
    AGM(["Agmarknet data source"])
    subgraph SYS["SmartCrop AI"]
        U1(["Enter soil values"])
        U2(["Select place and dates"])
        U3(["Fetch weather automatically"])
        U4(["Edit weather manually"])
        U5(["Compare crops"])
        U6(["View price prediction"])
        U7(["View explanation"])
        U8(["View history"])
    end
    F --- U1
    F --- U2
    F --- U3
    F --- U4
    F --- U5
    F --- U6
    F --- U7
    F --- U8
    U3 -.->|"uses"| OMA
    U6 -.->|"trained on"| AGM
    U5 -.->|"includes"| U1
    U5 -.->|"includes"| U2
    U5 -.->|"includes"| U7
    U4 -.->|"alternative to"| U3
```

*Figure 2. Use cases of the farmer. Open-Meteo and Agmarknet are external actors: Open-Meteo is
called live, and Agmarknet is the origin of the price data used to train the models.*
"Edit weather manually" is the fallback when the weather cannot be fetched.

### 9.3 Class diagram

The backend is mostly functions and a few classes. The diagram shows real classes plus logical
modules, marked with the `<<module>>` label.

```mermaid
classDiagram
    class ModelRegistry {
        +price
        +monthly
        +crop
        +load()
    }
    class CropRecommender {
        +classes
        +cities
        +calendar
        +economics
        +analyze(inputs, city, planting_month, selling_month, area_acres)
        +explain(inputs, city, planting_month, selling_month, crop)
    }
    class MonthlyPriceForecaster {
        +resolve_series(crop, city)
        +forecast_path(crop, city, target_year, target_month)
    }
    class PriceForecaster {
        +options()
        +reliability(h, commodity)
        +validated_horizons(commodity)
        +forecast(ref, as_of, target_date)
    }
    class CropCalendar {
        +crop
        +planting_months
        +growth_months_min
        +growth_months_max
        +max_storage_months
        +storable
    }
    class CropEconomics {
        +yield_q_per_acre
        +cost_per_acre_inr
        +post_harvest_loss_pct
        +marketing_cost_pct
    }
    class weather_service {
        <<module>>
        +locate(city, state)
        +growing_months(plant, sell)
        +growing_period_weather(city, state, plant, sell)
    }
    class WeatherError {
        +status_code
        +message
    }
    class recommendation_service {
        <<module>>
        +analyze(rec, body)
        +recommend(db, user, rec, body)
        +feature_ranges(rec)
    }
    class explainers {
        <<module>>
        +explain_crop()
        +explain_monthly_price()
        +explain_price()
    }
    class User {
        +id
        +name
        +email
        +password_hash
    }
    class CropRecommendation {
        +nitrogen
        +phosphorus
        +potassium
        +ph
        +city
        +planting_date
        +selling_date
    }
    class RecommendationResult {
        +rank
        +crop_name
        +recommendation_score
        +expected_profit
    }
    class PricePrediction {
        +market
        +commodity
        +predicted_price
        +future_trend
    }
    class ModelVersion {
        +model_type
        +version
        +algorithm
        +metrics
    }
    ModelRegistry o-- CropRecommender
    ModelRegistry o-- MonthlyPriceForecaster
    ModelRegistry o-- PriceForecaster
    CropRecommender --> MonthlyPriceForecaster : price path
    CropRecommender --> CropCalendar
    CropRecommender --> CropEconomics
    CropRecommender ..> explainers
    recommendation_service --> CropRecommender
    recommendation_service --> CropRecommendation : saves
    weather_service ..> WeatherError
    User "1" --> "*" CropRecommendation
    User "1" --> "*" PricePrediction
    CropRecommendation "1" --> "*" RecommendationResult
    ModelVersion "1" --> "*" CropRecommendation
    ModelVersion "1" --> "*" PricePrediction
```

*Figure 3. Main classes and modules.* `ModelRegistry` loads the three models once. `CropRecommender`
combines the classifier, the monthly price forecaster, the crop tables and the explainers.
The services connect the API routes to the models and the database.

### 9.4 Object diagram (drawn as a flowchart)

Concrete values from a real run of the code (Pune, planting in November, selling in April, planting
year 2026). The weather values are example inputs; the Brinjal figures are the model's output.

```mermaid
flowchart LR
    A["farmerInput : FarmerInput<br/>N = 115, P = 65, K = 70<br/>pH = 6.4<br/>city = Pune<br/>planting_month = 11<br/>selling_month = 4<br/>area_acres = 1"]
    B["weather : WeatherResult<br/>avgTemperature = 23.5<br/>avgHumidity = 62.0<br/>avgRainfall = 45.0<br/>source = Open-Meteo<br/>monthsUsed = 11, 12, 1, 2, 3, 4"]
    C["rec : CropRecommender<br/>7 crops, 11 cities"]
    D["brinjal : CropResult<br/>rank = 1, recommended = true<br/>agronomic_score = 100<br/>timing_score = 100<br/>profit_score = 82.2<br/>recommendation_score = 92.88<br/>status = fresh"]
    E["economics : Economics<br/>selling_price = 1796.62<br/>gross_revenue = 137441<br/>total_cost = 82658<br/>net_profit = 54784<br/>break_even_price = 1018"]
    A --> C
    B --> C
    C --> D
    D --> E
```

*Figure 4. One concrete set of objects.* The farmer input and the weather result go into the
recommender, which returns a ranked Brinjal result with its economics. Brinjal is ready in time
(`fresh`) after 5 months.

### 9.5 Sequence diagram

```mermaid
sequenceDiagram
    actor F as Farmer
    participant FE as React form
    participant API as FastAPI
    participant WX as weather_service
    participant OM as Open-Meteo
    participant ML as CropRecommender
    participant EX as Explainer
    participant DB as MySQL
    F->>FE: Enter soil, city, planting and selling month
    FE->>API: GET /api/weather after 500 ms
    API->>WX: growing_period_weather
    WX->>OM: Archive request for 3 years
    OM-->>WX: Daily temperature, humidity, rain
    WX-->>API: Averages
    API-->>FE: avgTemperature, avgHumidity, avgRainfall
    F->>FE: Click Compare crops for my field
    FE->>API: POST /api/crop-recommendation/recommend
    API->>ML: analyze
    ML->>EX: SHAP for each crop
    EX-->>ML: Reasons
    ML-->>API: 7 ranked crops with economics
    API->>DB: Save recommendation and results
    API-->>FE: Result JSON
    FE-->>F: Result page
```

*Figure 5. One full request.* The weather call happens first and fills the form. The recommendation
call then runs the models and the explainer, and the result is saved before it is returned.

### 9.6 Activity diagram

```mermaid
flowchart TD
    S(["Open Compare crops form"]) --> A["Enter soil values"]
    A --> B["Select city and months"]
    B --> C{"Weather fetch OK?"}
    C -->|"yes"| D["Show weather cards"]
    C -->|"no"| E{"Retry or edit?"}
    E -->|"retry"| C
    E -->|"edit manually"| F["Type weather values"]
    D --> G{"All values valid?"}
    F --> G
    G -->|"no"| H["Show validation message"]
    H --> A
    G -->|"yes"| I["Submit form"]
    I --> J["Backend ranks 7 crops"]
    J --> K{"Crop ready in time?"}
    K -->|"yes"| L["Mark ready in time"]
    K -->|"storage"| M["Mark sell from storage"]
    K -->|"no"| N["Mark not ready or spoiled"]
    L --> O(["Show result page"])
    M --> O
    N --> O
```

*Figure 6. From opening the form to the result.* The weather step can be repaired by retrying or
typing the values. The readiness check is made for every crop and only changes how it is labelled.

### 9.7 State chart diagrams

Weather section:

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Loading : city and months set
    Loading --> Loaded : weather received
    Loading --> Error : request failed
    Error --> Loading : retry
    Error --> ManualEdit : edit manually
    Loaded --> Loading : city or month changed
    Loaded --> ManualEdit : edit manually
    ManualEdit --> Loading : use automatic weather
```

*Figure 7a. States of the weather section.* Changing the city or a month always restarts loading.
Manual edit is reachable from Loaded and Error so the farmer is never blocked.

Form and prediction:

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Validating : values entered
    Validating --> Idle : invalid, show message
    Validating --> Submitting : all valid, click submit
    Submitting --> ShowingResults : server answers
    Submitting --> Failed : server error
    Failed --> Submitting : try again
    Failed --> Idle : edit values
    ShowingResults --> Idle : new comparison
```

*Figure 7b. States of the form.* The submit button is disabled until the form is valid. A server
error keeps the typed values so the farmer can try again.

### 9.8 Data flow diagrams

DFD level 0 (context):

```mermaid
flowchart LR
    F["Farmer"] -->|"soil values, city, months, field size"| P(("SmartCrop AI"))
    P -->|"ranked crops, prices, profit, explanation"| F
    OM["Open-Meteo"] -->|"daily weather"| P
    P -->|"place and month request"| OM
    AG["Agmarknet price data"] -->|"historical mandi prices"| P
```

*Figure 8a. DFD level 0.* The system exchanges data with three external entities: the farmer,
Open-Meteo and the Agmarknet price data.

DFD level 1:

```mermaid
flowchart TD
    F["Farmer"]
    OM["Open-Meteo"]
    P1(("1. Validate input"))
    P2(("2. Get weather"))
    P3(("3. Classify crops"))
    P4(("4. Project price and profit"))
    P5(("5. Explain result"))
    P6(("6. Save history"))
    D1[("D1 Weather cache")]
    D2[("D2 Price panels and models")]
    D3[("D3 Crop tables")]
    D4[("D4 MySQL history")]
    F -->|"form values"| P1
    P1 -->|"place and months"| P2
    P2 <-->|"request and daily data"| OM
    P2 <--> D1
    P2 -->|"weather values"| P3
    P1 -->|"soil values"| P3
    D3 -->|"calendar and economics"| P3
    P3 -->|"crop probabilities"| P4
    D2 -->|"price history and trained models"| P4
    D3 --> P4
    P4 -->|"prices and profit"| P5
    P3 --> P5
    P5 -->|"ranked result and reasons"| P6
    P6 --> D4
    P5 -->|"result page"| F
```

*Figure 8b. DFD level 1.* Six processes turn the form into a saved, explained result. Weather
passes through a cache store, price data and models sit in their own store, and history is the only
data written for later use.

### 9.9 Data model (ER diagrams)

The project stores data in MySQL (tables created by Alembic migrations in `backend/alembic/versions/`).

```mermaid
erDiagram
    USERS ||--o{ PRICE_PREDICTIONS : makes
    USERS ||--o{ CROP_RECOMMENDATIONS : makes
    MODEL_VERSIONS ||--o{ PRICE_PREDICTIONS : produced
    MODEL_VERSIONS ||--o{ CROP_RECOMMENDATIONS : produced
    CROP_RECOMMENDATIONS ||--o{ RECOMMENDATION_RESULTS : has
    USERS {
        int id PK
        string name
        string email UK
        string password_hash
        datetime created_at
    }
    MODEL_VERSIONS {
        int id PK
        string model_type
        string version
        string algorithm
        json metrics
    }
    PRICE_PREDICTIONS {
        int id PK
        int user_id FK
        int model_version_id FK
        string market
        string commodity
        date input_date
        int horizon_days
        decimal predicted_price
        json future_trend
    }
    CROP_RECOMMENDATIONS {
        int id PK
        int user_id FK
        int model_version_id FK
        float nitrogen
        float phosphorus
        float potassium
        float ph
        float temperature
        float humidity
        float rainfall
        string city
        string planting_date
        string selling_date
        float area_acres
    }
    RECOMMENDATION_RESULTS {
        int id PK
        int recommendation_id FK
        int rank
        string crop_name
        float recommendation_score
        float expected_profit
        json explanation
    }
```

*Figure 9a. Tables saved by the application (main columns only).* Each saved result points to the
user and to the model version that produced it. The full column list is in
[ARCHITECTURE.md](ARCHITECTURE.md).

The datasets are files, not tables. Their main columns:

```mermaid
erDiagram
    PRICE_ROWS {
        date Date
        string Market
        string Commodity
        string Variety
        float Arrivals
        float Min_Price
        float Max_Price
        float Modal_Price
    }
    SUPPORTED_SERIES {
        string Market
        string Commodity
        string Variety
        int observations
        float coverage
        bool supported
    }
    CROP_DATASET {
        float N
        float P
        float K
        float temperature
        float humidity
        float ph
        float rainfall
        string city
        int planting_month
        int selling_month
        string label
    }
    CITY_COORDINATES {
        string state
        string city
        float latitude
        float longitude
    }
    PRICE_ROWS }o--|| SUPPORTED_SERIES : summarised_by
    CROP_DATASET }o--|| CITY_COORDINATES : city
```

*Figure 9b. Dataset files and their main columns.* `supported_series.csv` summarises the price
rows by series. The crop dataset and the coordinates share the city name.

### 9.10 Machine learning pipeline

```mermaid
flowchart LR
    R1[["Raw Agmarknet prices"]] --> C1["Cleaning<br/>prepare_price_data.py"]
    C1 --> F1["Feature engineering<br/>features.py, monthly.py"]
    R2[["Generated crop dataset"]] --> F2["Features<br/>crop_recommendation/features.py"]
    F1 --> T1["Training<br/>train_price_model.py<br/>train_monthly_price_model.py"]
    F2 --> T2["Training<br/>train_recommendation_model.py"]
    T1 --> E1["Evaluation<br/>time-ordered cross-validation"]
    T2 --> E2["Evaluation<br/>hold-out and 5-fold CV"]
    E1 --> M[("Saved models<br/>trained_models/")]
    E2 --> M
    M --> PR["Prediction<br/>at request time"]
    PR --> XP["Explanation<br/>SHAP TreeExplainer"]
```

*Figure 10. Offline training and online prediction.* Training runs from the scripts in
`backend/scripts/`. The API only loads the saved models and never trains.

---

## 10. API reference

Base URL: `http://localhost:8000`. Interactive documentation: http://localhost:8000/docs.
All endpoints except register, login and health need the header
`Authorization: Bearer <access_token>`.

| Method | Path | Purpose | Success |
|---|---|---|---|
| POST | `/api/auth/register` | Create an account, returns a token and the user | 201 |
| POST | `/api/auth/login` | Log in, returns a token and the user | 200 |
| GET | `/api/auth/me` | Current user | 200 |
| PUT | `/api/auth/me` | Update name or change password | 200 |
| GET | `/api/weather` | Growing-period climate for a city (Open-Meteo) | 200 |
| GET | `/api/crop-recommendation/options` | Crops, cities, crop calendar, economics, input ranges | 200 |
| GET | `/api/crop-recommendation/feature-ranges` | Hard limits and usual range per crop for each input | 200 |
| POST | `/api/crop-recommendation/recommend` | Rank the 7 crops and save to history | 201 |
| POST | `/api/crop-recommendation/analyze` | Same ranking, not saved | 200 |
| POST | `/api/crop-recommendation/explain` | SHAP explanation for one crop | 200 |
| GET | `/api/price-prediction/options` | Crops, markets, today, forecast window | 200 |
| POST | `/api/price-prediction/predict` | Daily forecast and selling advice, saved to history | 201 |
| POST | `/api/price-prediction/trend` | Same forecast, not saved | 200 |
| POST | `/api/price-prediction/explain` | SHAP explanation for the target date | 200 |
| POST | `/api/price-prediction/monthly-forecast` | Monthly price path for a crop and city | 200 |
| GET | `/api/history/summary` | Totals and the 5 most recent of each type | 200 |
| GET | `/api/history/price?limit=&offset=` | Own price predictions, paged | 200 |
| GET, DELETE | `/api/history/price/{id}` | One own prediction | 200, 204 |
| GET | `/api/history/recommendations?limit=&offset=` | Own recommendations, paged | 200 |
| GET, DELETE | `/api/history/recommendations/{id}` | One own recommendation | 200, 204 |
| GET | `/api/health` | Server status and which models are loaded | 200 |

**Errors:** `401` missing, invalid or expired token, or wrong login · `404` not found (or not yours) ·
`409` email already registered · `422` invalid input · `502` or `504` the weather service failed or
timed out · `503` a model is not loaded · `500` unexpected error (logged, generic message).

### Register and log in

```http
POST /api/auth/register
Content-Type: application/json

{ "name": "Test Farmer", "email": "farmer@example.com", "password": "secret123" }
```

The response contains `access_token` and a `user` object. Log in with
`POST /api/auth/login` and `{ "email": "...", "password": "..." }`.

### Weather

```http
GET /api/weather?city=Pune&state=Maharashtra&plantMonth=11&sellMonth=4
Authorization: Bearer <access_token>
```

| Parameter | Meaning |
|---|---|
| `city` | City name (2 to 60 characters) |
| `state` | State name, default `Maharashtra` |
| `plantMonth`, `sellMonth` | Month numbers 1 to 12. The growing months run from planting to selling, both included, and may wrap over the new year. |

Example response (illustrative values; the field names and rounding are real):

```json
{
  "city": "Pune",
  "lat": 18.5204,
  "lon": 73.8567,
  "avgTemperature": 23.5,
  "avgHumidity": 62.0,
  "avgRainfall": 45.0,
  "source": "Open-Meteo",
  "monthsUsed": [11, 12, 1, 2, 3, 4]
}
```

Notes: results are cached in memory for 24 hours (key: latitude, longitude, months); a lookup that
fails is never cached; the request times out after 8 seconds. A city not found returns `404` with
the message "Could not find '<city>'. Try the nearest bigger city or enter weather manually."; a
provider problem returns `502` or `504`; wrong months return `422`.

### Feature ranges

```http
GET /api/crop-recommendation/feature-ranges
```

Returns, for each of `N`, `P`, `K`, `temperature`, `humidity`, `ph`, `rainfall`, the dataset
`min` and `max` and `perCrop`, the 5th to 95th percentile range of each crop:

```json
{ "N": { "min": 39.0, "max": 140.0, "perCrop": { "Brinjal": [74.0, 122.55] } } }
```

(abridged: the real response lists all 7 crops for all 7 features).

### Crop recommendation

```http
POST /api/crop-recommendation/analyze
Authorization: Bearer <access_token>
Content-Type: application/json

{ "nitrogen": 115, "phosphorus": 65, "potassium": 70, "temperature": 23.5, "humidity": 62,
  "ph": 6.4, "rainfall": 45, "state": "Maharashtra", "city": "Pune",
  "planting_month": 11, "selling_month": 4, "area_acres": 1, "soil_type": null }
```

Abridged response from a real run of the code on 2026-10-16 (`results` holds all 7 crops):

```json
{
  "city": "Pune", "planting_date": "2026-11", "selling_date": "2027-04", "growing_months": 5,
  "best_overall": "Brinjal",
  "weights": { "agronomic": 0.4, "timing": 0.2, "profit": 0.4 },
  "results": [
    { "rank": 1, "crop_name": "Brinjal", "recommended": true,
      "agronomic_score": 100.0, "timing_score": 100.0, "profit_score": 82.2,
      "recommendation_score": 92.88,
      "economics": { "selling_price": 1796.62, "gross_revenue": 137441.0,
                     "total_cost": 82658.0, "net_profit": 54784.0, "break_even_price": 1018.0 } }
  ]
}
```

### Price forecast

```http
POST /api/price-prediction/trend
Authorization: Bearer <access_token>
Content-Type: application/json

{ "state": "Maharashtra", "market": "All markets (state median)", "commodity": "Onion",
  "target_date": "2026-10-25" }
```

Abridged response (from a real local run on 2026-10-11):

```json
{
  "series": { "market": "All markets (state median)", "commodity": "Onion" },
  "current_price": 997.5,
  "target": { "horizon_days": 14, "date": "2026-10-25", "predicted_price": 1066.76,
              "lower": 788.54, "upper": 1347.53, "direction": "Stable", "beats_baseline": false },
  "advice": { "code": "UNCERTAIN", "label": "Forecast too uncertain to pick an exact date" },
  "model": { "approach": "direct multi-horizon (horizon is a feature), no recursion",
             "data_end": "2025-12-31" }
}
```

A target date more than 60 days ahead returns `422` with a plain-language message.

---

## 11. Project structure

```text
SmartCrop-AI/
├── README.md                    This file
├── ARCHITECTURE.md              Database schema, authentication, ML pipeline, SHAP
├── DATASET.md                   Data profiles and preprocessing decisions
├── MODEL_EVALUATION.md          Validation method and every measured metric
├── docs/screenshots/            Place screenshots here (see section 13)
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app: CORS, routers, loads models at startup, /api/health
│   │   ├── config/settings.py   Settings read from the environment and backend/.env
│   │   ├── auth/                JWT tokens, bcrypt passwords, current-user dependency
│   │   ├── database/            SQLAlchemy engine, session and Base
│   │   ├── models/              Database tables (users, predictions, recommendations, model versions)
│   │   ├── schemas/             Pydantic request and response shapes (includes weather.py)
│   │   ├── routes/              auth, price_prediction, crop_recommendation, history, weather
│   │   ├── services/            Business logic: recommendation, price, history, weather, model versions
│   │   └── ml/
│   │       ├── price_prediction/      Cleaning, features, daily and monthly forecasters, selling advice
│   │       ├── crop_recommendation/   Feature building and the CropRecommender class
│   │       ├── economics/             Profit and timing engine (profit.py)
│   │       ├── explainability/        SHAP turned into plain-language factors
│   │       ├── common/                Paths, reference tables, season rules
│   │       └── registry.py            Loads all models once
│   ├── alembic/ and alembic.ini       Database migrations (0001 initial, 0002 economic recommendation)
│   ├── scripts/                       Data preparation, dataset generation, training
│   ├── trained_models/                Saved models, metadata and validation metrics
│   ├── tests/                         pytest suite (83 tests)
│   ├── requirements.txt               Python packages
│   └── .env.example                   Configuration template
├── frontend/
│   ├── src/
│   │   ├── pages/               Dashboard, PricePrediction, PriceResult, CropRecommendation,
│   │   │                        CropResult, History, Profile, Login, Register, NotFound
│   │   ├── components/          Shared UI; charts/ (Recharts); crop/ (result sections, form parts)
│   │   ├── hooks/               useAsync, useAuth, useNarrow, useWeather
│   │   ├── services/            Axios instance and API wrappers (cropService, weatherService, ...)
│   │   ├── i18n/                English, Marathi and Hindi text
│   │   ├── utils/               Formatting, validation, featureRanges, cropPlan
│   │   └── index.css            App design system
│   ├── package.json, vite.config.js, tailwind.config.js
│   └── .env.example
└── dataset/
    ├── raw/                     Source CSVs (price file, legacy files)
    ├── processed/               Generated price panels
    ├── crop_price/              supported_series.csv
    ├── crop_recommendation/     Crop dataset, calendar, economics, climate, markets, coordinates
    └── reports/                 Data-quality report, dataset summary, training log
```

---

## 12. Installation and setup

### 12.1 Prerequisites

| Tool | Version used in development |
|---|---|
| Python | 3.13 |
| Node.js with npm | 20.x |
| MySQL Community Server | 8.0 |
| Git and VS Code | any recent version |
| Internet access | needed for the weather feature |

### 12.2 Clone

```powershell
git clone https://github.com/vaishnavipawar26/Major_Project.git
cd Major_Project/SmartCrop-AI
```

The folder `SmartCrop-AI` inside the repository holds the project.

### 12.3 Create the MySQL database

```sql
CREATE DATABASE smartcrop_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartcrop_user'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON smartcrop_ai.* TO 'smartcrop_user'@'localhost';
FLUSH PRIVILEGES;
```

### 12.4 Backend (terminal 1)

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `backend\.env` (see the table below), then create the tables:

```powershell
alembic upgrade head
```

The trained models and processed data are included, so no training is needed to run the app.

### 12.5 Frontend (terminal 2)

```powershell
cd frontend
npm install
copy .env.example .env
```

### 12.6 Environment variables

Templates: [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example). `.env` files are git-ignored.

| Variable | Meaning | Required | Where |
|---|---|---|---|
| `DATABASE_URL` | MySQL connection, for example `mysql+pymysql://user:password@localhost:3306/smartcrop_ai`. Encode `@` in a password as `%40`. | Yes | `backend/.env` |
| `JWT_SECRET_KEY` | Secret that signs login tokens, at least 32 characters. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. | Yes | `backend/.env` |
| `JWT_ALGORITHM` | Token algorithm, default `HS256` | No | `backend/.env` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime, 1 to 1440, default `60` | No | `backend/.env` |
| `CORS_ORIGINS` | Allowed frontend addresses as a JSON list, for example `["http://localhost:5173"]` | No | `backend/.env` |
| `ENVIRONMENT` | A label such as `development` | No | `backend/.env` |
| `DATASET_DIR`, `MODELS_DIR` | Override the dataset and trained-model folders | No | backend environment |
| `TEST_DATABASE_URL` | Run the tests against an empty MySQL database instead of SQLite | No | test shell |
| `VITE_API_URL` | Backend address for the frontend, default `http://localhost:8000` | No | `frontend/.env` |

The weather feature needs **no** key and no variable.

### 12.7 Run the project

Terminal 1, from `backend/` with the virtual environment active:

```powershell
uvicorn app.main:app --reload --port 8000
```

Terminal 2, from `frontend/`:

```powershell
npm run dev
```

| Address | What |
|---|---|
| http://localhost:5173 | The web app |
| http://localhost:8000/docs | API documentation (Swagger) |
| http://localhost:8000/api/health | Which models are loaded |

### 12.8 Rebuilding the models (optional)

Run from `backend/` with the virtual environment active. Training takes roughly 20 to 25 minutes on
a laptop. Restart the API afterwards.

```powershell
python -m scripts.prepare_price_data
python -m scripts.train_price_model
python -m scripts.train_monthly_price_model
python -m scripts.generate_crop_dataset
python -m scripts.train_recommendation_model
python -m scripts.score_sensitivity
```

---

## 13. How to use

**Example: Pune, planting in November, selling in April.**

1. Open http://localhost:5173, register and log in.
   ![Home page](docs/screenshots/home.png)
2. In the menu choose **Best Crop** (the page titled *Which crop should I grow?*, with the **Compare crops for my field** button).
   ![Dashboard](docs/screenshots/dashboard.png)
3. Under **Soil test results** enter N = 115, P = 65, K = 70 and pH = 6.4. (Or click *Fill sample
   values*.)
   ![Soil test results](docs/screenshots/soil-form.png)
4. Under **Place, dates and field** choose Pune, planting month November, selling month April and
   field size 1 acre. The badge shows "5 months from planting to selling".
5. Under **Weather while the crop grows** wait a moment. Temperature, humidity and rainfall appear
   with the note "Based on 3-year average for Pune, Nov-Apr (Open-Meteo)". If it fails, press
   *Retry* or *Edit manually*.
   ![Weather section](docs/screenshots/weather.png)
6. Press **Compare crops for my field**.
7. Read the result: the recommended crop, the **Best time to sell**, the price chart, the profit
   summary, the timeline and *Why this recommendation?*.
   ![Result page](docs/screenshots/result.png)
8. For prices, choose **Market Price** in the menu, pick a crop, market and date, and read *Why did the
   model predict this price?*.
   ![Price prediction](docs/screenshots/price.png)
9. Open **History** to reopen or delete saved results.

Screenshots are placeholders. Add the images to `docs/screenshots/` and do not include real names,
emails or tokens.

---

## 14. Testing

```powershell
cd backend
venv\Scripts\activate
python -m pytest
```

83 tests. They use a temporary SQLite database by default, so MySQL is not needed.

| Test file | What it covers |
|---|---|
| `test_auth.py` | Registration, login, token expiry and forged tokens, password rules, protected endpoints |
| `test_price_prediction.py` | Options, predict, trend, explain, SHAP additivity |
| `test_selling_advice.py` | Best-time-to-sell rules |
| `test_crop_recommendation.py` | Ranking of 7 crops, scores, feature ranges |
| `test_economics.py` | Profit, timing and break-even calculations |
| `test_ml_pipeline.py` | Preprocessing rules, feature leakage checks |
| `test_history.py` | Users cannot read or delete each other's records, paging |
| `test_migrations.py` | Migrations match the ORM models |
| `test_weather.py` | Weather success and cache, unknown city, provider failure not cached, stored coordinates, alias names, state preference, login needed, bad months |

The weather tests replace the network call with fake data, so they run offline.
The frontend has no automated tests; `npm run build` must succeed.

### Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `ModuleNotFoundError` when starting the backend | The virtual environment is not active, or `pip install -r requirements.txt` was not run. |
| Validation error about `DATABASE_URL` or `JWT_SECRET_KEY` | `backend/.env` is missing, or the secret is shorter than 32 characters. |
| `Can't connect to MySQL server` or `Access denied` | MySQL is not running, the user or password is wrong, or `@` in the password is not written as `%40`. |
| `Table ... doesn't exist` | Run `alembic upgrade head` in `backend/`. |
| API returns 503 or `/api/health` shows a model as `false` | A file in `backend/trained_models/` or `dataset/processed/` is missing. |
| "Cannot reach the SmartCrop server" | The backend is not running on port 8000, or `VITE_API_URL` points elsewhere. |
| CORS error in the browser console | Add the frontend address to the `CORS_ORIGINS` JSON list and restart the backend. |
| `error parsing value for field "CORS_ORIGINS"` | Write it as a JSON list, not comma separated. |
| Weather shows an error | The server needs internet access. On Windows, `CERTIFICATE_VERIFY_FAILED` usually means an antivirus or proxy is intercepting HTTPS. Use *Retry* or *Edit manually*. |

---

## 15. Limitations and future scope

### Limitations

- Only 7 crops, Maharashtra, and 11 cities for crop comparison. Price data ends on 2025-12-31.
- Forecasts for dates after the data are seasonal projections: the same calendar day of the last
  data year, plus an assumed 5 % per year inflation.
- Daily price forecasts are only about 2 % better than "no change". Day 1 is never validated and
  onion is not validated at any horizon.
- Selling-month prices are long-range estimates with large errors (MAPE about 45 %).
- The crop dataset was created by the team and is small and generated. The 85 % accuracy is for that
  data and not for real fields. Recommendations are not agronomic advice.
- Yields, costs, storage limits and climate normals are approximate reference values. The 40, 20, 40
  score weights are a design choice.
- Soil type is saved but not used by the models.
- No real-time events: weather forecasts, policy changes, strikes, pests, disease or transport.
- Weather is a 3-year average, not a forecast for the coming season.
- Models need retraining when new price data arrives.

### Future scope

- Add 2026 and later Agmarknet data and automate refresh and retraining.
- Replace the generated crop dataset with surveyed farm records.
- Use seasonal weather forecasts and district-level soil data.
- Calibrated uncertainty and storage-cost-aware selling advice.
- More states and crops.
- Frontend tests, continuous integration, one command to start everything, and deployment.
- Refresh tokens, rate limiting and account deletion.

### Security and privacy

- Never commit `.env` files. Only the `.env.example` templates are tracked.
- Passwords are stored only as bcrypt hashes; tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES`.
- Every history query is filtered by the logged-in user.
- If a secret is ever shared, rotate it (change the database password and generate a new JWT secret).

---

## 16. Black book reference guide

### 16.1 Chapter map

| Black book chapter | Where to find it |
|---|---|
| Abstract | [16.2](#162-abstract) |
| Introduction | [Section 2](#2-introduction-and-problem-statement), [Section 3](#3-objectives-and-scope) |
| Literature survey | [16.3](#163-literature-survey-topics) |
| Problem definition | [Section 2](#2-introduction-and-problem-statement) |
| Requirement analysis | [16.4](#164-requirements) |
| System design | [Section 9](#9-diagrams), [Section 11](#11-project-structure), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Implementation | [Sections 5 to 8](#5-technology-stack), [Section 10](#10-api-reference), [Section 12](#12-installation-and-setup) |
| Testing | [Section 14](#14-testing), [16.5](#165-sample-test-cases) |
| Results | [Section 8](#8-machine-learning-details), [MODEL_EVALUATION.md](MODEL_EVALUATION.md), [Section 13](#13-how-to-use) |
| Conclusion | [16.6](#166-conclusion) |
| Future scope | [Section 15](#15-limitations-and-future-scope) |
| References | [Section 17](#17-references-data-sources-and-license) |

### 16.2 Abstract

Farmers must decide which crop to plant and when to sell it, but they usually know only today's
market price and rarely have advice that fits their own field. SmartCrop AI is a web application for
Maharashtra that helps with both decisions. The farmer enters soil test values (nitrogen,
phosphorus, potassium and pH), the city, the planting month, the selling month and the field size.
The system fetches the average growing-period weather for that city from the free Open-Meteo
service, with a manual fallback. An XGBoost classifier trained on a team-built dataset of 4,550
examples scores how well each of seven crops suits the field. A second XGBoost model, trained on
246,067 Agmarknet mandi price records from 2023 to 2025, projects the price in the selling month. A
profit engine combines yield, cost and price, and a crop calendar checks whether each crop will be
ready, can be sold from storage, or would spoil. The crops are ranked by a weighted score, and SHAP
explains each result in plain language. A separate tool forecasts daily prices for up to 60 days. The
system uses React, FastAPI and MySQL and supports English, Marathi and Hindi. Its results are
estimates and are limited by the small generated crop dataset and the modest accuracy of price
forecasting.

### 16.3 Literature survey topics

Five suggested topics to read and cite (search for papers and textbooks on each):

1. Machine learning for crop recommendation from soil nutrients and climate (N, P, K, pH, rainfall).
2. Agricultural commodity price forecasting with time-series and tree-based models, including why
   short-term price forecasting is hard.
3. Gradient boosting (XGBoost) and Random Forest for tabular data.
4. Explainable AI for agriculture: SHAP and Shapley values for model explanation.
5. Digital market information systems for farmers in India (for example Agmarknet and e-NAM) and
   decision-support tools for farmers.

### 16.4 Requirements

**Functional requirements**

| ID | Requirement |
|---|---|
| FR1 | The user can register, log in, log out and edit their profile. |
| FR2 | The user can enter N, P, K and pH values, with validation against the data limits. |
| FR3 | The user can choose city, planting month, selling month, field size and optional soil type. |
| FR4 | The system fetches average temperature, humidity and rainfall for the growing months. |
| FR5 | The user can edit the weather values manually if the fetch fails or they prefer. |
| FR6 | The system ranks the 7 crops and marks up to 3 as recommended. |
| FR7 | The system shows whether each crop is ready in time, sellable from storage, or not ready. |
| FR8 | The system estimates the selling-month price, revenue, cost, net profit and break-even price. |
| FR9 | The system suggests the best month to sell within the sellable window. |
| FR10 | The system forecasts daily prices for a crop and market up to 60 days ahead. |
| FR11 | The system explains each prediction in plain language. |
| FR12 | The system saves results and lets the user view and delete their own history. |
| FR13 | The interface is available in English, Marathi and Hindi. |

**Non-functional requirements**

| ID | Requirement |
|---|---|
| NFR1 | Security: passwords are hashed, tokens expire, and users can read only their own records. |
| NFR2 | Performance: models load once at startup; weather results are cached for 24 hours; weather requests time out after 8 seconds. |
| NFR3 | Reliability: a weather failure never blocks the form; a missing model returns a clear 503. |
| NFR4 | Usability: simple wording, units shown, helpful validation messages, works on phones and desktops. |
| NFR5 | Accessibility: labelled inputs, keyboard navigation, status messages for loading and errors. |
| NFR6 | Maintainability: configuration in `.env`, migrations for the database, automated tests. |
| NFR7 | Honesty: every result is labelled as an estimate. |

**Software requirements:** Windows (used in development), Python 3.13, Node.js 20, MySQL 8, a modern
browser, Git, internet access for weather.

**Hardware requirements:** TODO: confirm the specification of the development laptop. As a rough
guide (not measured), a laptop with 8 GB RAM and a few GB of free disk space is enough to run the
app; training the daily price model took about 20 to 25 minutes on a laptop.

### 16.5 Sample test cases

| ID | Input | Expected output | Status |
|---|---|---|---|
| TC1 | `GET /api/weather` without a token | 401 | Automated, passes (`test_weather_needs_login`) |
| TC2 | `GET /api/weather?city=Pune&plantMonth=6&sellMonth=7` with a valid token | 200 with averages and `monthsUsed = [6, 7]` | Automated, passes (mocked provider) |
| TC3 | Same request twice | Second answer comes from the cache; provider called once | Automated, passes |
| TC4 | `plantMonth=13` | 422 | Automated, passes |
| TC5 | City not found by the geocoder | 404 with the "enter weather manually" message, not cached | Automated, passes |
| TC6 | Weather provider fails | 504 or 502, not cached, next request can succeed | Automated, passes |
| TC7 | City Chhatrapati Sambhajinagar | 200 using stored coordinates, geocoder not called | Automated, passes |
| TC8 | Register with a duplicate email | 409 | Covered by `test_auth.py` |
| TC9 | Open another user's history record | 404 | Covered by `test_history.py` |
| TC10 | N = 115, P = 65, K = 70, pH 6.4, Pune, plant Nov, sell Apr, example weather | 7 crops ranked; Brinjal first | Verified by a real run of the model on 2026-10-16 |
| TC11 | Soil value outside the data limits | Red message and the submit button stays disabled | Manual, not yet run |
| TC12 | Turn off the network, change a month | Weather error with Retry and Edit manually | Manual, not yet run |
| TC13 | Choose Edit manually, type three values, submit | Result page loads | Manual, not yet run |

### 16.6 Conclusion

SmartCrop AI shows that a farmer can get a field-specific crop comparison, a price estimate and a
plain-language explanation from one simple form. By fetching the growing-period weather
automatically and offering a manual fallback, it reduces typing without ever blocking the user. The
recommendation combines a machine-learning match score, a crop calendar and a profit calculation, so
the answer considers soil, weather, timing and money together. SHAP explanations make the reasons
visible. The project is also honest about its limits: the crop dataset was built by the team, price
forecasts are only modestly better than a simple baseline, and every number is an estimate. With
surveyed farm data, newer mandi prices and seasonal weather forecasts, the same design could become
a dependable decision-support tool for farmers.

---

## 17. References, data sources and license

### Data sources

- Agmarknet, Government of India: https://agmarknet.gov.in/
- Open Government Data Platform India: https://data.gov.in/ (exact dataset source: TODO: confirm)
- Open-Meteo Geocoding API: https://open-meteo.com/en/docs/geocoding-api
- Open-Meteo Historical Weather API: https://open-meteo.com/en/docs/historical-weather-api

### Libraries

[FastAPI](https://fastapi.tiangolo.com/) · [Pydantic](https://docs.pydantic.dev/) ·
[SQLAlchemy](https://www.sqlalchemy.org/) · [Alembic](https://alembic.sqlalchemy.org/) ·
[scikit-learn](https://scikit-learn.org/) · [XGBoost](https://xgboost.readthedocs.io/) ·
[SHAP](https://shap.readthedocs.io/) · [pandas](https://pandas.pydata.org/) ·
[httpx](https://www.python-httpx.org/) · [React](https://react.dev/) · [Vite](https://vite.dev/) ·
[Recharts](https://recharts.org/) · [Tailwind CSS](https://tailwindcss.com/) ·
[Mermaid](https://mermaid.js.org/)

### Authors and contact

| Name | GitHub | Contact |
|---|---|---|
| Vaishnavi Pawar | [@vaishnavipawar26](https://github.com/vaishnavipawar26) | TODO: confirm email |
| Shruti Temgire | [@shruti-temgire](https://github.com/shruti-temgire) | TODO: confirm email |

Guide, college and department: TODO: confirm. Individual contribution details: TODO: confirm.

### Contributing

1. Set the project up as in [section 12](#12-installation-and-setup).
2. Create a branch from an up-to-date `main`: `git checkout -b feature/short-description`.
3. Keep each change focused on one topic.
4. Check it: `python -m pytest` in `backend/`, `npm run build` in `frontend/`, and try the pages.
5. Make sure no `.env`, credentials or personal data are staged (`git status`, `git diff --staged`).
6. Push the branch and open a pull request into `main`. Retrained models should include the updated
   `metadata.json` and a note on how the metrics changed.

### License

**No license has been chosen yet.** Until a license file is added, the code is under the copyright of
its authors and others may not reuse it. TODO: confirm the license (for example MIT or Apache-2.0).
The datasets may carry their own terms.

---

## Glossary

| Term | Meaning |
|---|---|
| **Agmarknet** | The Government of India portal that publishes daily mandi arrivals and prices. |
| **APMC** | Agricultural Produce Market Committee, which runs a regulated wholesale market (mandi). |
| **Mandi** | A wholesale agricultural market. |
| **Quintal** | 100 kilograms. Prices in this project are ₹ per quintal. |
| **Modal price** | The most common price paid in a market on a day. |
| **Arrivals** | The quantity of a crop brought to a market. |
| **NPK** | Nitrogen (N), phosphorus (P) and potassium (K), the three main soil nutrients. Here they are in kg per hectare. |
| **pH** | A 0 to 14 scale of how acidic or alkaline the soil is. 7 is neutral. |
| **Guntha** | A land unit used in Maharashtra. 1 acre = 40 guntha. |
| **Growing period** | The months from planting to selling. |
| **Harvest-ready / sell from storage** | Ready in time means the crop can be sold fresh in the selling month. Sell from storage means it is harvested earlier and kept until then. |
| **XGBoost** | A machine-learning method that builds many small decision trees one after another. |
| **Random Forest** | A machine-learning method that averages many decision trees. |
| **Classifier** | A model that picks a category (here, a crop). |
| **SHAP** | A method that shows how much each input pushed one prediction up or down. |
| **Baseline ("no change")** | A simple guess that the future price equals today's price. A model is only useful if it beats it. |
| **Cross-validation** | Testing a model on data it was not trained on, several times. |
| **MAE, RMSE, MAPE** | Measures of forecast error. MAE is the average error in rupees; RMSE punishes big errors more; MAPE is the average error as a percentage. |
| **Mean reversion** | The tendency of a price far above or below normal to move back towards normal. |
| **Seasonal projection** | A forecast that reuses the same calendar day of the last data year, adjusted for assumed inflation. |
| **Geocoding** | Turning a place name into latitude and longitude. |
| **Cache** | A short-term store that avoids repeating the same request. |
| **JWT** | JSON Web Token, the signed login token sent with each request. |
| **ORM** | Object-relational mapper, code that reads and writes database tables as Python objects. |
