"""Persistent, shared store of valid environmental answers, in the project's own MySQL database (table environmental_records).

* One row per (record_type, place, day, data_type); a unique constraint prevents duplicates, also when several requests arrive at once.
* Only VALID provider answers are stored. A failed or empty answer is never written, so it can never overwrite a good one.
* Fresh rows are served directly. A row past its freshness time is used only when the live provider fails, and the screen then says when
  it was retrieved. A past day's archive record never goes stale.
* Every call uses its own short database session, so lookups running in parallel threads never share a session.
* If the table cannot be reached (for example a database that has not run ``alembic upgrade head``), the store is skipped and the live
  provider is used directly: the page still works, it just does not reuse earlier answers.
The price model does not read this table.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.database.connection import SessionLocal
from app.models.environmental_record import EnvironmentalRecord

log = logging.getLogger("smartcrop.environment_store")

VALUE_FIELDS = ("temperature_c", "humidity_pct", "rainfall_mm", "soil_ph", "soil_ph_scope", "soil_type")


def now() -> datetime:
    """UTC, without time-zone info (how the DateTime columns store it)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _key(lat: float, lon: float) -> tuple[float, float]:
    return round(float(lat), 4), round(float(lon), 4)


def _as_dict(r: EnvironmentalRecord) -> dict:
    return {"record_type": r.record_type, "data_type": r.data_type, "market": r.market, "place_name": r.place_name,
            "latitude": float(r.latitude), "longitude": float(r.longitude), "date_key": r.date_key,
            "observation_date": r.observation_date.isoformat() if r.observation_date else None,
            **{f: getattr(r, f) for f in VALUE_FIELDS}, "source": r.source, "status": r.status,
            "retrieved_at": r.retrieved_at.replace(tzinfo=timezone.utc).isoformat(timespec="seconds"),
            "is_fresh": r.expires_at is None or r.expires_at > now()}


def _find(s, record_type: str, lat: float, lon: float, date_key: str, data_type: str) -> EnvironmentalRecord | None:
    la, lo = _key(lat, lon)
    return s.execute(select(EnvironmentalRecord).where(
        EnvironmentalRecord.record_type == record_type, EnvironmentalRecord.latitude == la, EnvironmentalRecord.longitude == lo,
        EnvironmentalRecord.date_key == date_key, EnvironmentalRecord.data_type == data_type)).scalar_one_or_none()


def get(record_type: str, lat: float, lon: float, date_key: str, data_type: str) -> dict | None:
    """The stored row as a dict (with an ``is_fresh`` flag), or None when nothing is stored or the store cannot be reached."""
    try:
        with SessionLocal() as s:
            r = _find(s, record_type, lat, lon, date_key, data_type)
            return _as_dict(r) if r else None
    except SQLAlchemyError as exc:
        log.warning("environmental store not readable (%s); using the live provider only", type(exc).__name__)
        return None


def put(record_type: str, data_type: str, market: str, place_name: str | None, lat: float, lon: float, date_key: str,
        observation_date: date | None, values: dict, source: str, ttl: timedelta | None) -> dict:
    """Store a VALID answer (insert, or update the existing row for the same place, day and type). Returns the stored row as a dict.
    Values not given stay NULL. If the store cannot be written, the answer is still returned (marked as just retrieved)."""
    t = now()
    fields = {f: values.get(f) for f in VALUE_FIELDS}
    status = "ok" if all(fields[f] is not None for f in (("temperature_c", "humidity_pct", "rainfall_mm") if record_type == "weather"
                                                          else ("soil_ph", "soil_type"))) else "partial"
    row = {"record_type": record_type, "data_type": data_type, "market": market, "place_name": place_name, "date_key": date_key,
           "observation_date": observation_date, **fields, "source": source, "status": status, "retrieved_at": t,
           "expires_at": None if ttl is None else t + ttl}
    la, lo = _key(lat, lon)
    for attempt in range(2):          # a second try handles two requests inserting the same new row at the same moment
        try:
            with SessionLocal() as s:
                r = _find(s, record_type, la, lo, date_key, data_type)
                if r is None:
                    r = EnvironmentalRecord(latitude=la, longitude=lo, **row)
                    s.add(r)
                else:
                    for k, v in row.items():
                        if k != "market":          # keep the market that first asked; the place is the same
                            setattr(r, k, v)
                s.commit()
                return _as_dict(r)
        except IntegrityError:
            if attempt == 0:
                continue
            log.warning("environmental store: duplicate insert lost the race twice; returning the answer unsaved")
        except SQLAlchemyError as exc:
            log.warning("environmental store not writable (%s); answer returned without saving", type(exc).__name__)
            break
    return {**row, "latitude": la, "longitude": lo, "observation_date": observation_date.isoformat() if observation_date else None,
            "retrieved_at": t.replace(tzinfo=timezone.utc).isoformat(timespec="seconds"), "is_fresh": True}
