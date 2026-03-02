"""Model listing endpoint router."""

from fastapi import APIRouter

from multi_model_inference.core.model_registry import registry

router = APIRouter(prefix="/api/v1", tags=["models"])


@router.get("/models")
async def list_models():
    """List all registered models and their status."""
    return {"models": registry.list_models()}
