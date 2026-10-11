# dataset/

| Folder | Contents | Created by |
|---|---|---|
| `raw/` | Original, unmodified source files. **Never edited.** | Provided |
| `processed/` | `price_clean.parquet`, `price_daily_panel.parquet`, `price_monthly_seasonal_index.csv` | `backend/scripts/prepare_price_data.py` |
| `crop_price/` | `supported_series.csv` — which market series have enough history to forecast | `prepare_price_data.py` |
| `crop_recommendation/` | `crop_season_calendar.csv` (sourced), `crop_to_commodity_map.csv` | Hand-written reference files |
| `reports/` | `price_data_quality.md/.json`, training logs | Scripts |

Full documentation, sources and limitations: [`../DATASET.md`](../DATASET.md).

The processed files are committed because the API reads them at startup; regenerate them with:

```bash
cd backend
python -m scripts.prepare_price_data
```
