# SmartCrop-AI

A web app that helps farmers in Maharashtra, India, decide **which crop to grow** and **when to sell it**.

> **Status:** a college major project and working prototype. Its answers are estimates, not guarantees and not professional farming or financial advice.

## Contents

1. [The problem](#the-problem)
2. [Main features](#main-features)
3. [Price prediction and crop recommendation are different](#price-prediction-and-crop-recommendation-are-different)
4. [Project structure](#project-structure)
5. [Technologies](#technologies)
6. [How the application works](#how-the-application-works)
7. [Price prediction workflow](#price-prediction-workflow)
8. [Crop recommendation workflow](#crop-recommendation-workflow)
9. [Soil and weather information](#soil-and-weather-information)
10. [The database](#the-database)
11. [API endpoints](#api-endpoints)
12. [Models, training and evaluation](#models-training-and-evaluation)
13. [Install and run (Windows)](#install-and-run-windows)
14. [Run the tests](#run-the-tests)
15. [Limitations](#limitations)
16. [More documentation](#more-documentation)
17. [Authors and license](#authors-and-license)

## The problem

A farmer has two hard questions:

1. **Which crop should I plant?** The answer depends on the soil, the weather, the place, the season and the money the crop may earn.
2. **When should I sell?** Market prices change every week. Most farmers only know today's price.

SmartCrop-AI gives an answer for both questions and explains it in plain words.

## Main features

- **Price prediction.** Pick a crop, a market, the place where the crop grows and the day you plan to sell. The app shows past prices, the expected price and whether waiting a few days could earn more.
- **Crop recommendation ("Compare crops for my field").** Enter your soil test results, city and months. The app ranks 7 crops for your field and shows its reasons.
- **Weather and soil of your farm's area.** Shown next to the price (see [Soil and weather information](#soil-and-weather-information)).
- **Simple explanations.** Both tools show which things pushed the result up or down.
- **Accounts and history.** Register, log in, and see or delete your own past results.
- **Three languages:** English, Hindi and Marathi. Text that is not translated yet appears in English.

The 7 crops are Brinjal, Cabbage, Cauliflower, Onion, Potato, Tomato and Wheat.

## Price prediction and crop recommendation are different

| | Price prediction | Crop recommendation |
|---|---|---|
| Asks | "What price will my crop get, and when should I sell?" | "Which crop suits my field?" |
| Uses | Past market prices, how much crop arrived at the market, and the date | Your soil test, weather, city, planting month, selling month and expected profit |
| How | A machine-learning model predicts the price for each day up to 60 days ahead | Each crop gets a score out of 100 from six parts |

The two tools use different data and different logic. Their step-by-step workflows are below.

## Project structure

```text
SmartCrop-AI/
├── README.md, ARCHITECTURE.md, DATASET.md, MODEL_EVALUATION.md
├── frontend/                     The website (React)
│   ├── index.html, package.json, vite.config.js, tailwind.config.js,
│   │   postcss.config.js, eslint.config.js, .env.example
│   └── src/
│       ├── App.jsx, main.jsx     Page routes and app start
│       ├── pages/                One file per screen (+ its tests)
│       ├── components/           Reusable parts; price/, crop/ and charts/ folders
│       ├── services/             Functions that call the backend (Axios)
│       ├── hooks/, utils/, data/ Helper code, calculations and fixed lists
│       ├── context/, layouts/    Login session and page frames
│       └── i18n/                 English, Hindi and Marathi text
├── backend/                      The server (Python)
│   ├── app/
│   │   ├── main.py               Starts the API, checks the database, loads models
│   │   ├── config/settings.py    Reads settings from the .env file
│   │   ├── auth/                 Password hashing, login tokens, "who is logged in"
│   │   ├── database/             Database connection and version check
│   │   ├── models/               Database tables written as Python classes
│   │   ├── schemas/              Rules for what each request and response may contain
│   │   ├── routes/               The API endpoints (URLs)
│   │   ├── services/             The work behind each endpoint
│   │   └── ml/                   Machine-learning code
│   ├── alembic/ and alembic.ini  Database migrations (versions/ holds 0001 to 0005)
│   ├── scripts/                  Programs that prepare data and train models
│   ├── trained_models/           Saved models and their test results
│   ├── tests/                    Backend tests
│   └── requirements.txt, pytest.ini, .env.example
├── dataset/                      raw/, processed/, crop_price/, crop_recommendation/,
│                                 weather/, reports/
└── docs/                         PRICE_FEATURES.md, budget_plan.md
```

| Part | What it is for |
|---|---|
| `frontend/src/pages/` | The screens: Login, Register, Dashboard, PricePrediction (form), PriceResult, PriceExplanation, CropRecommendation (form), CropResult, CropExplanation, History, Profile |
| `backend/app/routes/` | `auth.py`, `price_prediction.py`, `crop_recommendation.py`, `history.py`, `weather.py`. Each file lists the URLs of one feature. |
| `backend/app/services/` | `price_service.py` and `recommendation_service.py` run the two main features. `price_weather_service.py`, `geocoding_service.py` and `weather_service.py` fetch weather, places and soil. `environment_store.py` saves what was fetched. `history_service.py` reads a user's saved results. |
| `backend/app/ml/` | `registry.py` loads the models. `price_prediction/` holds the price forecaster and selling advice. `crop_recommendation/` holds the crop ranking and the budget plan. `economics/` calculates profit. `explainability/` builds the SHAP explanations. |
| `backend/trained_models/` | The saved model files (`.joblib`) for crop recommendation, daily price, monthly price, and the price reliability rules. |
| `backend/alembic/versions/` | Step-by-step database changes. Running `alembic upgrade head` applies them in order. |
| `backend/scripts/` | Run by hand to prepare data and train models. The running app never calls them. |
| `.env` files | Your private settings (database address, secret key). Copy from `.env.example`. Never share or upload them. |
| `requirements.txt` / `package.json` | The lists of Python and JavaScript libraries to install. |
| `backend/tests/` and `*.test.jsx` / `*.test.js` files | Automated checks (see [Run the tests](#run-the-tests)). |
| `ARCHITECTURE.md`, `DATASET.md`, `MODEL_EVALUATION.md` | Detailed documents about the design, the data and the model results. |

## Technologies

| Technology | What it does in SmartCrop-AI |
|---|---|
| **React** | Builds the web pages: forms, results and the history list. |
| **Vite** | Runs the website while you develop (`npm run dev`) and packages it for use (`npm run build`). |
| **Recharts** | Draws the charts: the price graph and the "What affects your crop price?" bars. |
| **Tailwind CSS** | Helps style the pages, next to the project's own stylesheet. |
| **Python** | The language of the server and all machine-learning code. |
| **FastAPI** | The server. It receives requests from the website, checks them and sends answers. It also makes the page at `/docs`. |
| **MySQL** | Stores users, saved results and fetched weather and soil data. |
| **SQLAlchemy** | Lets Python code read and write MySQL tables without writing raw SQL. |
| **Alembic** | Creates the database tables and applies later changes safely (`alembic upgrade head`). |
| **JWT and bcrypt** | After login the server gives a signed token (JWT). The website sends it with every request. Passwords are stored only as bcrypt hashes. |
| **XGBoost** | A fast model that learns from data. Used for short-range daily prices, the monthly price model and the crop classifier. |
| **scikit-learn** | Provides Random Forest, a model used for longer-range daily prices, and the tools that wrap the crop classifier. |
| **SHAP** | Explains one prediction by showing how much each input pushed it up or down. |
| **pandas and NumPy** | Read and calculate with the datasets. |
| **joblib** | Saves a trained model to a file and loads it again. |
| **Open-Meteo** | Free weather service. Gives weather and forecasts, and finds places by name. |
| **SoilGrids (ISRIC)** | A world soil map. Gives estimated soil pH and soil type for a place. |
| **httpx** | The library the server uses to call Open-Meteo and SoilGrids. |
| **pytest, Vitest, ESLint** | Run the automated tests and check code style. |

Exact versions are in `backend/requirements.txt` and `frontend/package.json`.

## How the application works

Every feature follows the same basic path. Which parts it touches depends on the feature.

```text
Farmer -> React website -> FastAPI server -> [ MySQL | trained model | Open-Meteo / SoilGrids ] -> FastAPI answer -> React shows the result
```

1. **The farmer opens the website** (`http://localhost:5173`). Pages other than Login and Register are protected. Without a login token the farmer is sent to the login page.
2. **Login.** The farmer registers or logs in. The server checks the password (stored as a bcrypt hash) and returns a signed token valid for 60 minutes by default. The website keeps the token in the browser and adds it to every request. If the server answers "401 not logged in" (for example, the token expired), the website logs the user out.
3. **The website shows a form.** For example, the price form or the crop form. The form checks simple mistakes first (empty fields, dates out of range).
4. **The farmer submits.** The website sends the data to the server's API (`frontend/src/services/`).
5. **The server checks the request.** Pydantic rules in `backend/app/schemas/` reject wrong input with a clear message. The login token identifies the user.
6. **A service does the work.** It uses an already loaded model, dataset files, the database or an outside service, depending on the feature.
7. **The server calculates the result.** For `predict` and `recommend`, the result is also saved in MySQL for that user.
8. **The server sends a response** (JSON data).
9. **The website shows the result:** numbers, charts and explanations. The result stays on the screen even if the page is refreshed (the website keeps the last result in the browser session), and it can be reopened later from History.

When the server starts, it also (a) checks that the database is up to date and stops with `Run: alembic upgrade head` if not, and (b) loads the saved models once. If a model file is missing, the endpoints that need it answer "503 not available".

## Price prediction workflow

**1. What the farmer enters** (`PricePrediction.jsx`): the crop, the market (the list depends on the crop), the growing location (chosen from a list of popular places or searched by name) and the selling date (from tomorrow up to 60 days ahead). The state is fixed to Maharashtra.

**2. On submit** the website sends `POST /api/price-prediction/predict` with crop, market, date and the growing location's name and coordinates. It then opens the result page. The result page also asks `POST /api/price-prediction/explain` in the background for the explanation.

**3. The server prepares the inputs** (`price_service.py`, `ml/price_prediction/forecaster.py`). It starts from **today**. It finds the market's price history for that crop. If that market has no usable history, it tries the state-median series, then another market. From the history it builds the model's **29 inputs**: recent price changes, averages, ups and downs, how much crop arrived at the market, the calendar, crop and market codes, and how many days ahead the date is (full list: [docs/PRICE_FEATURES.md](docs/PRICE_FEATURES.md)).

**4. Which model is used.** The code picks the saved model by distance: **days 1-12 use XGBoost, days 13-60 use Random Forest** (the split is stored in `trained_models/price_prediction/metadata.json`). All models are loaded at start-up. Nothing is trained during use.

**5. The predicted price.** The model predicts how much the price will change from the starting price. The code turns that change into rupees per quintal for every day. It also gives a likely range, based on the model's errors in testing.

**6. Past and future prices on the page.** The graph "How Much Might My Crop Sell For?" shows the last 60 days of **real** reported prices (solid line) and the expected prices (dashed line). The selling date is highlighted with its expected price. If the market stopped reporting, a grey band says "No price records" instead of joining the dots. A note shows the latest recorded price and its date. If the farmer's start date is after the last data (31 Dec 2025), the page says that the latest price is not today's price.

**7. Comparing selling dates** (`selling_advice.py`). The planned date is compared with later dates. A later date is suggested only if its expected price is higher than the planned date's by **more than the model's usual error**, and only within a storage limit for that crop. The "Smart Selling Recommendation" card shows the planned date, the best other date, the difference and the waiting time.

**8. Explanations (SHAP).** For the chosen distance, `shap.TreeExplainer` finds how much each input pushed the price up or down. The code groups the 29 inputs into a few plain factors (for example, current price level, seasonal trend, recent price movement, usual crop and market pattern). The "What Affects Your Crop Price?" chart shows them as green (pushes up) and red (pushes down) bars. This shows patterns the model learned. It does not prove a cause.

**9. When the model is not reliable.** For each crop and distance, a saved rule file (`trained_models/price_reliability/crop_policy.json`) says whether the model beat the simple guess "the price stays the same" in testing. If not (for example Onion), the page shows **no expected price and no breakdown**. It shows past prices and says so.

**10. What is saved.** One row in `price_predictions` (crop, market, dates, current and predicted price, range, direction, the daily path, the growing location's name). A row in `model_versions` is added the first time a model version is used.

**Weather and soil do not change the price.** The Field Conditions panel is looked up after the forecast, for display only. See [Soil and weather information](#soil-and-weather-information).

## Crop recommendation workflow

**1. What the farmer enters** (`CropRecommendation.jsx`): soil test values (nitrogen, phosphorus, potassium, pH), an optional soil type, the city, planting month, selling month and field size. Optionally also a budget, a priority and a risk level.

**2. Weather is filled in automatically.** After the city and months are chosen, the website waits half a second and calls `GET /api/weather`. It returns the average temperature, humidity and monthly rainfall of the last 3 completed seasons for that city and those months. If that fails, the farmer types the values (manual mode). The soil values are always typed by the farmer, from a soil test report.

**3. On submit** the website sends `POST /api/crop-recommendation/recommend`. The server checks the city and the value limits. Weather values outside the range seen in training are limited to that range for the calculation (the saved record keeps the real values).

**4. Every crop is checked and scored** (`ml/crop_recommendation/recommender.py`). **The score uses fixed rules and one machine-learning price forecast. The classifier does not decide the score.** Each part is 0-100:

| Part | Weight | How it is worked out |
|---|---|---|
| Location | 20% | Half: how common this crop is in the farmer's city in the training data. Half: how well the city's usual climate fits the crop. |
| Planting month | 20% | 100 in a planting month from the crop calendar, 50 one month off, 0 otherwise. |
| Selling month | 10% | From the crop calendar: 100 if freshly harvested in that month, less for each month of storage, 0 if not ready or spoiled. |
| Soil match | 15% | Share of your N, P, K and pH values inside the crop's usual range. |
| Weather match | 15% | The same for temperature, humidity and rainfall. |
| Expected profit | 20% | `50 + 50 × tanh(profit ÷ cost)`. Profit uses the monthly **price model** (XGBoost) for the selling month, the crop's yield and costs, and storage losses. |

**Overall score** = 0.20 × location + 0.20 × planting + 0.10 × selling + 0.15 × soil + 0.15 × weather + 0.20 × profit. The weights were chosen by the team. They are **not learned** from data. A script (`scripts/score_sensitivity.py`) shows how rankings change if the weights change.

**5. The classifier.** An XGBoost classifier also gives each crop a match probability. This number is **not part of the score**. It only helps explain the model, together with SHAP.

**6. Final ranking.** Crops are sorted by overall score. A crop is **recommended** only if its planting month is acceptable, at least 5 of the 7 soil and weather values are in its usual range, it can be sold in the chosen month, and its expected profit is positive. Up to **3** crops are recommended. All 7 are always returned, so the comparison chart shows every option. If the farmer entered a budget, priority or risk level, a "personal plan" picks the best crop *for them* after the scoring (`budget_plan.py`); it never changes a score ([docs/budget_plan.md](docs/budget_plan.md)).

**7. SHAP.** SHAP explains the **classifier**, not the score. The "Why this recommendation?" panel groups the SHAP values into soil, weather, timing and location. The reasons shown next to the score come from the rules above.

**8. What is saved.** One row in `crop_recommendations` (the inputs) and 7 rows in `recommendation_results` (each crop's rank, scores, expected price, revenue, cost, profit and reasons), plus `model_versions` when new.

## Soil and weather information

| Where | Source | What the farmer sees | Used for |
|---|---|---|---|
| **Price page, "Field Conditions"** | Open-Meteo (weather), SoilGrids (soil) | Temperature, humidity, rainfall, soil pH, soil type and the growing location | **Only shown.** It does not change the price or the explanation. |
| **Crop form, weather cards** | Open-Meteo archive | Average temperature, humidity and monthly rainfall of past seasons | **Used** in the crop score (weather match) and by the classifier. |
| **Crop form, soil values** | Typed by the farmer from a soil test | N, P, K, pH, optional soil type | **Used** in the crop score (soil match) and by the classifier. SoilGrids is not used here. |

**What the values mean (price page).** Temperature, humidity and rainfall are for the selling date. They are a forecast if the date is within 15 days, or a past record otherwise. Soil pH tells how acidic the soil is. Soil type is the main soil group of the area (for example Vertisols, a dark clay soil).

**How they are found** (`price_weather_service.py`). The farmer's growing location gives a latitude and longitude. Weather comes from Open-Meteo. Soil comes from the SoilGrids REST service. If that is down, the same maps are read through ISRIC's map service. The soil group name is accepted only after a second map confirms it. If the exact spot has no pH (for example a built-up area), the app uses the farmland about 2 km around it and says so.

**When information is missing:**
- The value shows **"Unavailable"** with a short reason. It is never replaced by zero, a default or another place's value.
- Failed requests are retried. If a service keeps failing, it is skipped for 5 minutes.
- The whole lookup is cut off after 8 seconds, so the price is never delayed.
- If an earlier answer for the same place and day was saved, it is used and marked.
- If the growing location cannot be found, everything is shown as unavailable. The selling market is **not** used instead.

**Limits.** Weather is available only up to 15 days ahead, so a selling date 40 days away shows weather as unavailable. Soil values are **map estimates** (250 metre squares), **not tests of your own soil**.

## The database

The server uses MySQL. Tables are created by Alembic migrations, not by hand.

| Table | What it stores | Used by | Kind |
|---|---|---|---|
| `users` | Name, email, password hash (never the password) | Login and every saved result | User |
| `price_predictions` | Each saved price prediction: crop, market, dates, current and predicted price, range, direction, daily path, growing location name | Price prediction, History | Prediction |
| `crop_recommendations` | The farmer's inputs for each crop comparison, including optional budget, priority and risk | Crop recommendation, History | Recommendation |
| `recommendation_results` | One row per crop for a comparison: rank, scores, expected price, revenue, cost, profit, reasons | Crop recommendation, History | Recommendation |
| `model_versions` | Which model version made a result (type, version, algorithm, test metrics) | Both features | Model |
| `environmental_records` | Weather and soil answers saved by place, date and type, so the same lookup is reused | Price page Field Conditions | Cached data |

**Who can see what.** `price_predictions` and `crop_recommendations` each have a `user_id`. Every History query filters by the logged-in user's id. Asking for another user's record gives "404 not found", so its existence is not revealed. Deleting works the same way. `environmental_records` holds public weather and soil data, not personal data. The price table also has empty columns `temperature`, `humidity`, `ph`, `rainfall`, `soil_type`; the app currently writes only `growing_location` to it.

## API endpoints

Start the server and open **http://localhost:8000/docs** for the full, interactive list. All endpoints need the header `Authorization: Bearer <token>` except `register`, `login` and `health`.

**Authentication**

| Endpoint | Purpose | Accepts | Returns |
|---|---|---|---|
| `POST /api/auth/register` | Create an account | name, email, password (8-72 characters) | A token and the user |
| `POST /api/auth/login` | Log in | email, password | A token and the user |
| `GET /api/auth/me` | Who am I | nothing | Name, email, dates |
| `PUT /api/auth/me` | Change name or password | optional name; current and new password | The updated user |

**Price prediction** (`/api/price-prediction/...`)

| Endpoint | Purpose | Accepts | Returns |
|---|---|---|---|
| `GET options` | Fill the form | nothing | Crops, markets, today's date, the 60-day limit |
| `POST predict` | New forecast, saved to history | crop, market, selling date, growing location | Past prices, expected prices, selling advice, `environmental_factors`, saved id |
| `POST trend` | Same forecast, not saved (also reopens a saved one) | same, plus `as_of` date | Same as `predict` |
| `POST explain` | SHAP explanation | same | Factor groups and reasons |
| `POST monthly-forecast` | Monthly price path for a crop | crop, selling month and year | Monthly prices with an explanation |
| `GET locations?q=` | Search places | typed text | Matching places with coordinates |
| `GET locations/popular` | Places shown before typing | nothing | Popular Maharashtra places |
| `GET weather-context` | Weather for a place and date | market, date, optional place | Temperature, humidity, rainfall, status |
| `GET soil-context` | Soil for a place | market, optional place | Soil pH, soil type, status |

**Crop recommendation** (`/api/crop-recommendation/...`)

| Endpoint | Purpose | Accepts | Returns |
|---|---|---|---|
| `GET options` | Fill the form | nothing | Crops, cities, calendar, cost assumptions, input ranges |
| `GET feature-ranges` | Allowed and usual value ranges | nothing | Limits per input and per crop |
| `POST recommend` | Compare crops, saved to history | soil values, weather values, soil type, city, months, field size, optional budget, priority, risk | All 7 crops ranked with scores, profit and reasons; recommended crop; warnings; optional personal plan |
| `POST analyze` | Same, not saved | same | Same as `recommend` |
| `POST explain` | SHAP explanation for one crop | inputs and a crop name | Why the model favours or doubts that crop |

**Weather for the crop form:** `GET /api/weather?city=&planting_month=&selling_month=` returns average temperature, humidity and monthly rainfall of the last 3 completed seasons.

**History** (`/api/history/...`)

| Endpoint | Purpose |
|---|---|
| `GET summary` | How many results the user has saved |
| `GET price`, `GET price/{id}`, `DELETE price/{id}` | List, read or delete saved price predictions |
| `GET recommendations`, `GET recommendations/{id}`, `DELETE recommendations/{id}` | List, read or delete saved crop comparisons |

**Health:** `GET /api/health` (no login) shows which models are loaded.

## Models, training and evaluation

Four words are easy to mix up:

| Step | Meaning | When it happens in SmartCrop-AI |
|---|---|---|
| **Training** | The program studies a dataset and learns patterns | **Offline**, by running scripts in `backend/scripts/`. Never during normal use. |
| **Saving** | The learned model is written to a `.joblib` file | At the end of a training script, into `backend/trained_models/` |
| **Loading** | The server reads the saved file into memory | **Once, when the server starts** (`ml/registry.py`) |
| **Predicting** | The loaded model gives an answer for one request | Every time a farmer submits a form |

So the app uses the **existing saved models**. The files are included in the project, so you do not need to train anything. Retrain only when new data arrives (commands in `backend/README.md` and `backend/scripts/`).

| Model | Learns from | Tested how | Result |
|---|---|---|---|
| Daily price model (XGBoost + Random Forest) | Mandi prices 2023-2025 | 4 time-ordered rounds over 2025 | Average error ₹400 per quintal, against ₹406.5 for "the price stays the same". Only slightly better, and not better at every distance or crop. |
| Monthly price model (XGBoost) | Monthly prices | Two time-ordered cut-offs | Average error ₹616 against ₹750 for "no change". About 45% error in percent terms. |
| Crop classifier (XGBoost) | Crop recommendation dataset | 910 held-out original rows | Accuracy 0.851. This measures how well it separates **this dataset**, not real fields. |

**Datasets** (details in [DATASET.md](DATASET.md)):
- **Mandi prices:** 246,067 rows, 1 Jan 2023 to 31 Dec 2025, 7 crops, 297 markets (`dataset/raw/`). The team says the data comes from Agmarknet (Government of India). The exact download route is not recorded and needs confirmation.
- **Crop recommendation data (team-created, simulated):** 4,550 rows written by the team from typical crop ranges, plus 3,850 synthetic (computer-generated) rows, 8,400 in total. **It was not measured on real farms.** Its ranges should be reviewed by an agronomist.
- **Hand-written tables:** crop calendar, yields and costs, city climate, city coordinates.

More results and method: [MODEL_EVALUATION.md](MODEL_EVALUATION.md).

## Install and run (Windows)

You need Python 3.12 or newer, Node.js 18 or newer, MySQL 8 and Git.

**1. Get the code** (any folder):

```powershell
git clone https://github.com/vaishnavipawar26/Major_Project.git
cd Major_Project\SmartCrop-AI
```

**2. Create the database.** Run this in MySQL and choose your own password:

```sql
CREATE DATABASE smartcrop_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartcrop_user'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON smartcrop_ai.* TO 'smartcrop_user'@'localhost';
```

**3. Set up the backend** (in the `backend` folder):

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
```

Open the new `backend\.env` file and fill in two values:
- `DATABASE_URL`: your MySQL address, in the form `mysql+pymysql://USER:PASSWORD@localhost:3306/smartcrop_ai`
- `JWT_SECRET_KEY`: a secret of at least 32 characters

Never share or upload this file. `alembic upgrade head` creates all the tables.

**4. Set up the frontend** (in the `frontend` folder):

```powershell
cd ..\frontend
npm install
```

An optional `frontend\.env` (copy of `.env.example`) is only needed if the backend is not at `http://localhost:8000`.

**5. Start the app.** The backend and the website are two separate programs, so you need **two terminals** open at the same time. Make sure MySQL is running first (the `MySQL80` service).

```powershell
# Terminal 1: in the backend folder, virtual environment active
python -m uvicorn app.main:app --reload --port 8000

# Terminal 2: in the frontend folder
npm run dev
```

Open **http://localhost:5173**, register, and log in. The API guide is at http://localhost:8000/docs.

## Run the tests

The tests need no internet and no MySQL. Backend tests use a temporary database and replace all outside services with fake data.

```powershell
# Backend: in the backend folder, virtual environment active
python -m pytest

# Frontend: in the frontend folder
npm test
```

| Tests | What they check |
|---|---|
| Backend (`backend/tests/`) | Register, login and who can see which records. Price prediction, explanations, selling advice and the reliability rules. Crop ranking, profit and the budget plan. Weather, soil and place lookups, including failures. Database migrations. Data and feature rules. |
| Frontend (`*.test.jsx`, `*.test.js`) | The forms and their error messages, the result pages, the charts, the Field Conditions panel (including "Unavailable"), the weather hook, and the calculation helpers. |

Optional: `npm run lint` checks code style and `npm run build` makes the production version of the website.

## Limitations

- Only Maharashtra and 7 crops.
- Price data ends on 31 December 2025. For later dates the app uses earlier-year prices as a guide, and it says so on the page.
- The price model is only a little better than guessing "the price stays the same". For some crops and distances it is not shown at all.
- The crop data was **created by the team**, not measured on real farms. Treat the crop ranking as a guide.
- Soil values on the price page are map estimates. Weather is limited to 15 days ahead.
- Weather, soil and place search need internet and can be unavailable. The page then says "Unavailable".
- Place search does not list every village.
- Real-life events such as strikes, policy changes, pests or transport problems are not modelled.

## More documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the system is built
- [DATASET.md](DATASET.md): the data and how it was cleaned
- [MODEL_EVALUATION.md](MODEL_EVALUATION.md): how the models were tested and their results
- [docs/PRICE_FEATURES.md](docs/PRICE_FEATURES.md): every input of the price model
- [docs/budget_plan.md](docs/budget_plan.md): the budget and risk plan

## Authors and license

Vaishnavi Pawar ([@vaishnavipawar26](https://github.com/vaishnavipawar26)) and Shruti Temgire ([@shruti-temgire](https://github.com/shruti-temgire)).

**License:** none has been chosen yet. Until one is added, others may not reuse the code.
