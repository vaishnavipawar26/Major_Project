# Proposed database change: weather and price factors (NOT APPLIED)

Status: proposal only. No migration has been written into `backend/alembic/versions/` and nothing has been run.
A verified backup exists at `C:\Users\Shruti Temgire\Major_Project\db_backups\smartcrop_ai_20261027_210317.sql`.

## What exists today (verified)

* MySQL tables: `users`, `crop_recommendations`, `recommendation_results`, `price_predictions`, `model_versions`, `alembic_version`.
* Market prices, arrivals (`Arrivals`), min/max/modal prices are **not in MySQL**. They live in `dataset/processed/*.parquet`
  and are read by the price model at startup.
* Market weather (daily mean temperature, rainfall, relative humidity) is now in
  `dataset/weather/market_weather_daily.parquet`, with model-ready features in `dataset/weather/weather_features_daily.parquet`
  (Open-Meteo archive, ERA5 reanalysis, matched to a market by its town coordinates in `dataset/crop_price/market_locations.csv`).
* `price_predictions.arrivals` already stores the arrivals used for a saved prediction.

## Recommendation: no schema change is needed to train or serve the model

The model reads files, not MySQL. Adding database columns would not make it use any new feature. Weather and prices
should stay in the dataset files, which keeps the original data untouched and the change easy to undo.

## Optional change (only if you want each saved prediction to remember its inputs)

One nullable JSON column, so old rows stay valid and nothing is rewritten:

```python
# backend/alembic/versions/0004_price_prediction_factors.py  (proposed)
def upgrade():
    op.add_column("price_predictions", sa.Column("factors_snapshot", sa.JSON(), nullable=True))

def downgrade():
    op.drop_column("price_predictions", "factors_snapshot")
```

It would hold, per prediction, the values the model actually used and their status, for example
`{"weather": {"status": "not_used"}, "arrivals": 166.0, "model_version": "..."}`. Values are copied from the model's own
inputs and are left out (never zero-filled) when unavailable.

Not proposed: a separate weather or price table in MySQL. It would duplicate the dataset files and nothing would read it.

## Approval needed

Reply "approve 0004" to have the migration written and applied (after a fresh backup), or "no database change" to skip it.

## Proposed `factors_snapshot` structure (kept for later; not implemented until you approve the column)

Raw inputs and explanation values are stored apart, and anything unavailable is stored as `null` with a status, never 0:

```json
{
  "schema": 1,
  "model_version": "202610170304",
  "latest_price_date": "2025-12-31",
  "inputs": [
    {"feature": "log_price", "value": 6.8, "unit": "ln(Rs/quintal)", "source": "AGMARKNET reports",
     "as_of": "2025-10-27", "used_by_model": true},
    {"feature": "log_arrivals", "value": null, "status": "unavailable", "used_by_model": true}
  ],
  "explanation": {"method": "SHAP TreeExplainer", "space": "log(price[t+h]/price[t])",
                  "baseline": 0.0109, "contributions": {"season": -0.081, "price_level": 0.018}},
  "background_weather": {"status": "not_used_by_model", "observed": null, "forecast": null}
}
```

Existing rows keep `NULL`. The app must not start without the migration being applied (`check_schema` stops the server), so the
migration file is deliberately NOT in `backend/alembic/versions/` yet.
