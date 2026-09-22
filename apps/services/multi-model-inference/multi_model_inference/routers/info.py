"""Service info endpoint router."""

from fastapi import APIRouter

from multi_model_inference.config import settings
from multi_model_inference.core.model_registry import registry
from multi_model_inference.core.readiness import readiness_state

router = APIRouter(tags=["info"])


@router.get("/")
async def service_info():
    """Root endpoint returning service metadata."""
    loaded = registry.model_names
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "status": readiness_state(),
        "models_loaded": len(loaded),
        "models": loaded,
        "docs": "/docs",
    }
