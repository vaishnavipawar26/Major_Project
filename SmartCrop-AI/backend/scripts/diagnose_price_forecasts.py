"""Diagnostic: can every supported crop / market produce a 30-day forecast and a selling comparison, and if not, exactly why?

Run from backend/:  python -m scripts.diagnose_price_forecasts [--markets N]

For each supported crop it takes the state-median series, the N best-covered markets and the two least-covered listed markets, then runs the
real forecaster (the same code as the API) for two planned dates (today + 10 and + 25 days) and reports: usable history, the latest actual
price and its date, whether a model forecast was produced, the reliability policy for that crop and distance (and its reason), the number of
validated days in the 30-day window, and whether the graph and the selling recommendation can be built.

Output: dataset/reports/price_forecast_diagnostics.json and .md. Nothing is changed.
"""
from __future__ import annotations

import argparse
import json
from datetime import timedelta

import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.forecaster import ForecastError, PriceForecaster, SeriesRef
from app.ml.price_prediction.window import build_window
from app.services import price_service

STATE_MARKET = "All markets (state median)"


def series_to_test(fc: PriceForecaster, crop: str, n: int) -> list[tuple[str, SeriesRef, int]]:
    sup = fc.support[(fc.support["Commodity"] == crop) & (fc.support["supported"])].copy()
    sup = sup.sort_values(["observations", "Market"], ascending=[False, True])
    state = sup[sup["Market"] == STATE_MARKET]
    mk = sup[sup["Market"] != STATE_MARKET].drop_duplicates("Market")
    picks = [("state median", state.iloc[0])] if len(state) else []
    picks += [("well covered", r) for _, r in mk.head(n).iterrows()]
    picks += [("thinly covered", r) for _, r in mk.tail(2).iterrows() if r["Market"] not in set(mk.head(n)["Market"])]
    return [(kind, SeriesRef(r["State"], r["Market"], r["Commodity"], r["Variety"]), int(r["observations"])) for kind, r in picks]


def check(fc: PriceForecaster, ref: SeriesRef, start, days: int) -> dict:
    target = start + timedelta(days=days)
    try:
        f = fc.forecast(ref, start, target, explain=False)
    except ForecastError as exc:
        return {"days": days, "forecast": False, "error": str(exc)}
    w = build_window(f, hold_days=(f["advice"].get("storage") or {}).get("farm_hold_days"))
    t = f["target"]
    return {"days": days, "forecast": True, "source": f["source"]["kind"], "method": f["source"]["method"],
            "policy": (f.get("policy") or {}).get("mode"), "policy_reason": ((f.get("policy") or {}).get("reasons") or [""])[0],
            "target_validated": bool(t.get("beats_baseline")), "model_mae": t.get("model_mae"), "baseline_mae": t.get("baseline_mae"),
            "validated_days": w["validated_days"], "unvalidated_days": w["unvalidated_days"], "unavailable_days": w["unavailable_days"],
            "comparison": w["comparison"]["code"], "graph": w["validated_days"] > 0, "projected": bool(f.get("projection"))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markets", type=int, default=3)
    n = ap.parse_args().markets
    fc = PriceForecaster()
    start = price_service.today()
    rows = []
    for crop in fc.meta["commodities"]:
        for kind, ref, obs in series_to_test(fc, crop, n):
            latest = fc.latest_for(ref, start)
            entry = {"crop": crop, "market": ref.market, "variety": ref.variety, "kind": kind, "observations": obs,
                     "latest_price": latest and latest["price"], "latest_date": latest and latest["date"],
                     "checks": [check(fc, ref, start, d) for d in (10, 25)]}
            rows.append(entry)
            print(crop, "|", ref.market, "|", [(c["forecast"], c.get("policy"), c.get("validated_days"), c.get("comparison")) for c in entry["checks"]], flush=True)
    out = paths.REPORTS_DIR
    (out / "price_forecast_diagnostics.json").write_text(json.dumps({"start": start.isoformat(), "rows": rows}, indent=2, default=str), encoding="utf-8")
    lines = [f"# Price forecast diagnostics (forecast start {start})", "",
             "| Crop | Market | Role | Obs | Latest actual | Planned +10 d: policy / validated days / comparison | Planned +25 d | Reason |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        def cell(c):
            return f"no forecast ({c['error'][:50]})" if not c["forecast"] else f"{c['policy']} / {c['validated_days']}/30 / {c['comparison']}"
        c0 = r["checks"][0]
        why = (c0.get("policy_reason") or "")[:110] if c0["forecast"] and c0.get("policy") != "model" else ""
        lines.append(f"| {r['crop']} | {r['market']} | {r['kind']} | {r['observations']} | "
                     f"{r['latest_price'] or '—'} ({r['latest_date'] or '—'}) | {cell(c0)} | {cell(r['checks'][1])} | {why} |")
    (out / "price_forecast_diagnostics.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out / 'price_forecast_diagnostics.md'}")


if __name__ == "__main__":
    main()
