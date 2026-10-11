from datetime import datetime, timedelta, timezone

import jwt

from app.config.settings import get_settings


class TokenError(Exception):
    pass


def create_access_token(user_id: int) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    expires = timedelta(minutes=s.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "type": "access", "iat": now, "exp": now + expires}
    token = jwt.encode(payload, s.JWT_SECRET_KEY, algorithm=s.JWT_ALGORITHM)
    return token, int(expires.total_seconds())


def decode_access_token(token: str) -> int:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.JWT_SECRET_KEY, algorithms=[s.JWT_ALGORITHM],
                             options={"require": ["sub", "exp", "iat"]})
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Invalid token") from exc
    if payload.get("type") != "access":
        raise TokenError("Invalid token type")
    try:
        return int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise TokenError("Invalid token subject") from exc
