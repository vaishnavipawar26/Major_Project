import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config.settings import get_settings
from app.ml.registry import ModelRegistry
from app.routes import auth, crop_recommendation, history, price_prediction, weather

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smartcrop")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.registry = ModelRegistry().load()
    reg = app.state.registry
    log.info("Models loaded: price=%s monthly=%s crop=%s", reg.price is not None,
             reg.monthly is not None, reg.crop is not None)
    yield


app = FastAPI(title="SmartCrop AI API",
              description="Explainable crop price prediction and crop recommendation",
              version="1.0.0", lifespan=lifespan)

app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])

app.include_router(auth.router)
app.include_router(price_prediction.router)
app.include_router(crop_recommendation.router)
app.include_router(history.router)
app.include_router(weather.router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health", tags=["Health"])
def health(request: Request) -> dict:
    reg = request.app.state.registry
    return {"status": "ok", "price_model_loaded": reg.price is not None,
            "monthly_price_model_loaded": reg.monthly is not None,
            "crop_model_loaded": reg.crop is not None}
