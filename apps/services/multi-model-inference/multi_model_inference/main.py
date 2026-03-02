"""FastAPI application entry point for the multi-model inference service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from multi_model_inference.config import settings
from multi_model_inference.core.model_registry import registry
from multi_model_inference.models.sentence_embedder import MODEL_NAME, SentenceEmbedder
from multi_model_inference.routers import embeddings, health, info, models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _register_models() -> None:
    """Register all enabled models with the registry."""
    model_map = {
        MODEL_NAME: SentenceEmbedder,
        # Future models: "sentiment": SentimentModel, etc.
    }
    for name in settings.enabled_models:
        if name in model_map:
            registry.register(name, model_map[name]())
        else:
            logger.warning("Unknown model in ENABLED_MODELS: '%s' -- skipping.", name)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: load models on startup, unload on shutdown."""
    _register_models()
    registry.load_all()
    logger.info("All models loaded. Service is ready.")
    yield
    registry.unload_all()
    logger.info("All models unloaded. Service shutting down.")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

# Include routers
app.include_router(info.router)
app.include_router(health.router)
app.include_router(models.router)
app.include_router(embeddings.router)
