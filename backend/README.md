# SmartCrop AI — Backend (FastAPI)

Setup, environment variables, database creation and training are described in the
[root README](../README.md); architecture, schema and API in [ARCHITECTURE.md](../ARCHITECTURE.md).

Quick reference (from `backend/`, venv active):

| Task | Command |
|---|---|
| Install | `pip install -r requirements.txt` |
| Create tables | `alembic upgrade head` |
| New migration after model change | `alembic revision --autogenerate -m "describe change"` |
| Data quality + cleaning | `python -m scripts.prepare_price_data` |
| Train daily price models | `python -m scripts.train_price_model` |
| Train monthly price model | `python -m scripts.train_monthly_price_model` |
| Generate synthetic crop dataset | `python -m scripts.generate_crop_dataset` |
| Train crop model | `python -m scripts.train_recommendation_model` |
| Weight sensitivity | `python -m scripts.score_sensitivity` |
| Run API | `uvicorn app.main:app --reload --port 8000` |
| Tests | `python -m pytest` |

`trained_models/` holds the joblib models (committed, because the API needs them at startup;
re-create them with the scripts) plus the evaluation outputs (`metadata.json`, CV metrics CSVs, confusion matrix).
