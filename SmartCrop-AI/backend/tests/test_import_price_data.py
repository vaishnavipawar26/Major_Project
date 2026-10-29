"""Price import: validation, duplicate handling and the written files, on SYNTHETIC test rows only (never real prices, never written to dataset/)."""
import json
from datetime import date

import pandas as pd
import pytest

from app.ml.price_prediction.preprocessing import REQUIRED_COLUMNS, find_price_files
from scripts import import_price_data as imp

EXISTING = pd.DataFrame({
    "Date": ["2025-12-30", "2025-12-31", "2025-12-31"] * 20,
    "State": ["Maharashtra"] * 60,
    "Market": ["Pune(Manjri)", "Pune(Manjri)", "APMC Sillod"] * 20,
    "Commodity": ["Onion", "Onion", "Wheat"] * 20,
    "Variety": ["Other"] * 60,
    "Arrivals": [100.0] * 60, "Min_Price": [900.0, 900.0, 2400.0] * 20, "Max_Price": [1300.0, 1300.0, 2700.0] * 20,
    "Modal_Price": [1100.0, 1100.0, 2550.0] * 20})
EXISTING = imp.normalise(EXISTING.drop_duplicates(["Date", "Market", "Commodity"]))
TODAY = date(2026, 10, 28)


def src(**over):
    base = {"Arrival_Date": ["01/01/2026", "02/01/2026", "02/01/2026"], "State": ["Maharashtra"] * 3,
            "Market": ["Pune(Manjri)", "Pune(Manjri)", "APMC Sillod"], "Commodity": ["Onion", "Onion", "Wheat"],
            "Variety": ["Other"] * 3, "Arrivals": ["120", "130", "10"], "Min Price": ["950", "960", "2450"],
            "Max Price": ["1350", "1360", "2750"], "Modal Price": ["1150", "1160", "2600"]}
    base.update(over)
    return pd.DataFrame(base)


def run(df, **kw):
    kw.setdefault("today", TODAY)
    return imp.validate_import(df, EXISTING, **kw)


def test_source_headers_are_mapped_and_day_first_dates_parse():
    new, rej, rep = run(src())
    assert list(new.columns) == REQUIRED_COLUMNS and rep["rows_new"] == 3 and rej.empty
    assert rep["date_min"] == "2026-01-01" and rep["date_max"] == "2026-01-02"


def test_missing_columns_refuse_the_whole_file():
    with pytest.raises(imp.ImportError_, match="Missing columns"):
        run(src().drop(columns=["Variety"]))


def test_unparsable_dates_refuse_the_file_instead_of_guessing():
    with pytest.raises(imp.ImportError_, match="Dates could not be parsed"):
        run(src(Arrival_Date=["31/31/2026", "x", "y"]))


def test_only_maharashtra_and_the_seven_crops_are_kept():
    new, rej, rep = run(src(State=["Maharashtra", "Gujarat", "Maharashtra"], Commodity=["Onion", "Onion", "Rice"]))
    assert rep["rows_new"] == 1 and rep["rejected_not_maharashtra"] == 1 and rep["rejected_not_one_of_the_seven_crops"] == 1


def test_invalid_prices_and_future_dates_are_rejected_not_repaired():
    new, rej, rep = run(src(**{"Modal Price": ["0", "1160", "2600"], "Arrival_Date": ["01/01/2026", "02/01/2026", "02/11/2026"]}))
    assert rep["rows_new"] == 1
    assert rep["rejected_missing_or_non_positive_modal_price"] == 1 and rep["rejected_date_out_of_range"] == 1
    new, rej, rep = run(src(**{"Min Price": ["2000", "960", "2450"]}))
    assert rep["rejected_min_above_max"] == 1


def test_a_per_kilogram_file_is_refused_unless_the_unit_is_declared():
    n = 60
    kg = pd.DataFrame({"Date": pd.date_range("2026-01-01", periods=n).strftime("%Y-%m-%d"), "State": "Maharashtra", "Market": "Pune(Manjri)",
                       "Commodity": "Onion", "Variety": "Other", "Arrivals": "5", "Min_Price": "9", "Max_Price": "13", "Modal_Price": "11"})
    with pytest.raises(imp.ImportError_, match="not in Rs per quintal"):
        run(kg)
    new, _, rep = run(kg, price_unit="kg")
    assert rep["rows_new"] == n and new["Modal_Price"].iloc[0] == 1100.0


def test_unknown_markets_are_rejected_with_suggestions_never_renamed():
    new, rej, rep = run(src(Market=["Pune (Manjri)", "Pune(Manjri)", "Brand New Mandi"]))
    assert rep["rejected_market_not_in_current_dataset"] == 2
    assert "Brand New Mandi" in rep["unmatched_markets"] and "Pune(Manjri)" in rep["unmatched_markets"]["Pune (Manjri)"]
    assert set(new["Market"]) == {"Pune(Manjri)"}
    # an explicit mapping is the only way a differently spelled market is accepted
    new2, _, rep2 = run(src(Market=["Pune (Manjri)", "Pune(Manjri)", "APMC Sillod"]), market_map={"Pune (Manjri)": "Pune(Manjri)"})
    assert rep2["rows_new"] == 3 and set(new2["Market"]) == {"Pune(Manjri)", "APMC Sillod"}
    new3, _, rep3 = run(src(Market=["Brand New Mandi"] * 3), allow_new_markets=True)
    assert rep3["rows_new"] == 3 and set(new3["Market"]) == {"Brand New Mandi"}


def test_existing_records_are_never_overwritten_merged_or_duplicated():
    same = src(Arrival_Date=["31/12/2025"] * 3, **{"Min Price": ["900", "900", "2400"], "Max Price": ["1300", "1300", "2700"],
                                                    "Modal Price": ["1100", "1111", "2550"]})
    # row 0 equals the existing Onion record; row 1 has the same key (same variety, market, date) but another modal price -> conflict;
    # row 2 (Wheat, Sillod) equals the existing record
    same["Variety"] = ["Other"] * 3
    new, rej, rep = run(same)
    assert rep["rows_new"] == 0
    assert rep["rejected_already_present_identical"] + rep["rejected_conflicts_with_existing_record"] == 3
    assert rep["rejected_conflicts_with_existing_record"] >= 1
    assert set(rej["reason"]) <= {"already_present_identical", "conflicts_with_existing_record", "exact_duplicate_in_file"}


def test_exact_duplicate_rows_inside_the_file_are_dropped_once():
    d = src()
    new, rej, rep = run(pd.concat([d, d.iloc[[0]]], ignore_index=True))
    assert rep["rows_new"] == 3 and rep["rejected_exact_duplicate_in_file"] == 1


def test_apply_writes_the_exact_schema_once_and_is_idempotent(tmp_path, monkeypatch):
    raw, reports = tmp_path / "raw", tmp_path / "reports"
    raw.mkdir()
    EXISTING.to_csv(raw / "base.csv", index=False)
    f = tmp_path / "incoming.csv"
    src().to_csv(f, index=False)
    monkeypatch.setattr(imp, "date", type("D", (), {"today": staticmethod(lambda: TODAY)}))
    args = [str(f), "--source", "agmarknet", "--out-dir", str(raw), "--report-dir", str(reports)]
    assert imp.main(args) == 0 and not list(raw.glob("imported_*"))                  # a dry run writes nothing into raw/
    assert imp.main(args + ["--apply"]) == 0
    out = list(raw.glob("imported_agmarknet_20260101_20260102.csv"))
    assert len(out) == 1
    written = pd.read_csv(out[0])
    assert list(written.columns) == REQUIRED_COLUMNS and len(written) == 3 and str(written["Date"].iloc[0]).startswith("2026-")
    assert out[0] in find_price_files(raw)                                              # the existing pipeline picks it up automatically
    manifest = json.loads((reports / "price_import_manifest.json").read_text())
    assert manifest["imports"][0]["rows"] == 3 and len(manifest["imports"][0]["sha256"]) == 64
    assert imp.main(args + ["--apply"]) == 2                                             # the same file cannot be applied twice
    # the same records again under another file name: every row is already present, so nothing new is written
    f2 = tmp_path / "again.csv"
    src(Variety=["Other"] * 3, Arrivals=["120", "130", "11"]).to_csv(f2, index=False)
    assert imp.main([str(f2), "--source", "other", "--out-dir", str(raw), "--report-dir", str(reports), "--apply"]) == 3
    assert len(list(raw.glob("imported_*"))) == 1
