"""One small, robust way for the API to call public data services (Open-Meteo, SoilGrids).

* Uses the operating-system certificate store through ``truststore`` (already a project dependency, and what the data scripts use). Some
  networks (college or office networks with TLS inspection) only trust their certificate through the OS store; plain ``httpx`` then fails
  every request, which is why the same page showed data for one team member and "Unavailable" for another. Certificate checks are never
  turned off.
* Retries a failed request once or twice with a short pause (timeouts, connection errors, HTTP 429 and 5xx). Other client errors are not
  retried: asking again would give the same answer.
* Backs off from a provider that is down: after a request to a host fails because the host is unreachable, slow or overloaded, that host
  is not called again for BACKOFF_SECONDS and callers get ``(None, "backoff")`` at once. Without this, every price prediction would wait
  for the full timeouts while, for example, SoilGrids is offline. Kept in memory only; nothing is stored about the failure.
* Never raises. Returns ``(json, None)`` on success or ``(None, reason)`` where reason is a short code for the logs and for a friendly
  message on screen. Raw error text is never sent to the browser.
"""
from __future__ import annotations

import logging
import ssl
import time
from functools import lru_cache

from urllib.parse import urlsplit

import httpx

log = logging.getLogger("smartcrop.http")

RETRY_STATUS = {429, 500, 502, 503, 504}
BACKOFF_SECONDS = 300
BACKOFF_REASONS = {"timeout", "network", "server_error", "rate_limited"}
_down_until: dict[str, float] = {}     # host -> monotonic time until which it is not called


def _pause(seconds: float) -> None:
    """Wait between attempts (its own function, so tests can skip the wait without touching time.sleep everywhere)."""
    time.sleep(seconds)


@lru_cache(maxsize=1)
def _verify() -> ssl.SSLContext | bool:
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:   # truststore missing or unusable: fall back to httpx's own certificate bundle (still verified)
        return True


def get_json(url: str, params: dict | list, timeout: float, attempts: int = 2, pause: float = 0.6) -> tuple[dict | None, str | None]:
    """GET returning (parsed JSON, None) or (None, reason)."""
    return _get(url, params, timeout, attempts, pause, lambda r: r.json())


def get_bytes(url: str, params: dict | list, timeout: float, attempts: int = 2, pause: float = 0.6) -> tuple[bytes | None, str | None]:
    """GET returning (response body, None) or (None, reason), with the same retries and per-host back-off as get_json."""
    return _get(url, params, timeout, attempts, pause, lambda r: r.content)


def _get(url: str, params, timeout: float, attempts: int, pause: float, parse) -> tuple:
    host = urlsplit(url).netloc
    if _down_until.get(host, 0.0) > time.monotonic():
        return None, "backoff"
    reason = "unknown"
    for i in range(attempts):
        try:
            r = httpx.get(url, params=params, timeout=timeout, verify=_verify())
            if r.status_code in RETRY_STATUS:
                reason = "rate_limited" if r.status_code == 429 else "server_error"
            elif r.status_code >= 400:
                log.warning("%s answered HTTP %s", url, r.status_code)
                return None, "rejected"
            else:
                _down_until.pop(host, None)
                return parse(r), None
        except httpx.TimeoutException:
            reason = "timeout"
            _down_until[host] = time.monotonic() + BACKOFF_SECONDS   # other requests skip this host while this one retries
        except httpx.TransportError as exc:   # DNS, refused connection, TLS/certificate problems
            reason = "network"
            _down_until[host] = time.monotonic() + BACKOFF_SECONDS
            log.warning("%s unreachable: %s", url, type(exc).__name__)
        except ValueError:                       # not the expected format
            return None, "bad_response"
        if i + 1 < attempts:
            _pause(pause * (i + 1))
    log.warning("%s failed after %d attempt(s): %s", url, attempts, reason)
    if reason in BACKOFF_REASONS:
        _down_until[host] = time.monotonic() + BACKOFF_SECONDS
        log.warning("%s: not called again for %d s", host, BACKOFF_SECONDS)
    return None, reason
