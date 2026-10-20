"""HTTP client for the offline data scripts.

Uses the operating-system certificate store when the optional ``truststore`` package is
installed (needed on networks whose TLS inspection certificate is only in the OS store).
Certificate verification is never disabled.
"""
from __future__ import annotations

import ssl

import httpx


def make_client(timeout: float = 30.0) -> httpx.Client:
    try:
        import truststore
        verify: ssl.SSLContext | bool = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        verify = True
    return httpx.Client(timeout=timeout, verify=verify)
