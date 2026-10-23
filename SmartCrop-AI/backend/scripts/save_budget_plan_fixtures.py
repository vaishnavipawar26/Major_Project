"""Save REAL API responses for the budget plan as frontend test fixtures (so tests render what the API really sends, not a hand-made mock).

Run from backend/:   python -m scripts.save_budget_plan_fixtures
Output:              frontend/src/test-fixtures/budget_plan_real.json
Each scenario holds the request, the full /recommend response and the matching /history/recommendations item.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.database.base import Base
from tests import conftest as c

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test-fixtures" / "budget_plan_real.json"
CAB = dict(soil_type="sandy_loam", nitrogen=115, phosphorus=60, potassium=75, ph=6.3, temperature=21, humidity=70, rainfall=90, city="Pune", area_acres=1)
SCENARIOS = {
    # nothing fits the budget: the cheapest suitable crop is shown and every other crop is listed with its reason
    "no_fit_budget": dict(CAB, planting_month=10, selling_month=1, budget_inr=40000, priority="balanced", risk_level="medium"),
    # one crop fits: a single "Best for you" card
    "one_card": dict(CAB, planting_month=10, selling_month=1, budget_inr=60000, priority="balanced", risk_level="medium"),
    # the plan agrees with the standard #1 and other crops fit too
    "matches_standard": dict(CAB, planting_month=10, selling_month=2, budget_inr=80000, priority="balanced", risk_level="medium"),
    # no budget entered, only a risk level
    "no_budget": dict(CAB, planting_month=10, selling_month=2, priority="spend_less", risk_level="low"),
}


def main() -> None:
    Base.metadata.drop_all(c.engine)
    Base.metadata.create_all(c.engine)
    out = {}
    with TestClient(c.app) as cl:
        user = c.make_user(cl)
        for name, body in SCENARIOS.items():
            r = cl.post("/api/crop-recommendation/recommend", headers=user["headers"], json=body)
            assert r.status_code == 201, r.text
            rec = r.json()
            items = cl.get("/api/history/recommendations?limit=100", headers=user["headers"]).json()["items"]
            out[name] = {"request": body, "response": rec, "history_item": next(i for i in items if i["id"] == rec["id"])}
    Base.metadata.drop_all(c.engine)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
