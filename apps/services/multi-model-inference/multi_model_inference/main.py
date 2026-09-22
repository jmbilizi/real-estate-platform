"""FastAPI application entry point for the multi-model inference service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from multi_model_inference.config import settings
from multi_model_inference.core.model_registry import registry
from multi_model_inference.models.sentence_embedder import MODEL_NAME, SentenceEmbedder
from multi_model_inference.routers import embeddings, health, info, models


class _ProbeLogFilter(logging.Filter):
    """Suppress K8s probe endpoints from uvicorn access logs."""

    _PROBE_PATHS = ("/health", "/ready")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(p in msg for p in self._PROBE_PATHS)


logging.basicConfig(level=logging.INFO)
logging.getLogger("uvicorn.access").addFilter(_ProbeLogFilter())
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

    failed = [
        model_name
        for model_name in registry.model_names
        if not registry.get(model_name).is_ready
    ]
    if failed and settings.model_load_required:
        logger.error(
            "Model load failed for: %s. Service is running but NOT ready.",
            ", ".join(failed),
        )
    elif failed:
        # The weights were not baked into this image, so a failed download is an
        # expected outcome on a network that blocks HuggingFace. Serve degraded
        # rather than reporting a defect (#287).
        logger.warning(
            "Model load failed for: %s. MODEL_LOAD_REQUIRED is false, so the service "
            "is ready in a degraded state and embedding requests will fail.",
            ", ".join(failed),
        )
    else:
        logger.info("All models loaded. Service is ready.")

    yield
    registry.unload_all()
    logger.info("All models unloaded. Service shutting down.")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url=None,  # Served via API Gateway's SwaggerForOcelot
    redoc_url=None,  # Served via API Gateway's SwaggerForOcelot
)

# Include routers
app.include_router(info.router)
app.include_router(health.router)
app.include_router(models.router)
app.include_router(embeddings.router)
