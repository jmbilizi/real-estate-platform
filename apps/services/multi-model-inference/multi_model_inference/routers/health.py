"""Health and readiness check routers."""

from fastapi import APIRouter

from multi_model_inference.core.model_registry import registry

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    """Liveness probe -- always returns ok if the process is running."""
    return {"status": "ok"}


@router.get("/ready")
async def ready():
    """Readiness probe -- returns ready only when all models are loaded."""
    models_info = {info["name"]: info["status"] for info in registry.list_models()}
    is_ready = registry.all_ready()
    return {
        "status": "ready" if is_ready else "loading",
        "models": models_info,
    }
