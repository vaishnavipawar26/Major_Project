from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.ml.common.paths import BACKEND_DIR


class Settings(BaseSettings):
    """Configuration loaded from environment variables / backend/.env. No secrets have defaults."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8",
                                      extra="ignore")

    APP_NAME: str = "SmartCrop AI"
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = Field(..., description="mysql+pymysql://user:pass@host:3306/smartcrop_ai")

    JWT_SECRET_KEY: str = Field(..., min_length=32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(60, gt=0, le=24 * 60)

    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def split_origins(cls, v):
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
