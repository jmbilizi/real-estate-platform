"""Health and readiness check routers."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from multi_model_inference.core.model_registry import registry

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    """Liveness probe -- always returns ok if the process is running.

    Model load state must never affect this endpoint. A model that fails to
    load leaves the service not ready, not dead, so K8s must not restart it.
    """
    return {"status": "ok"}


@router.get(
    "/ready",
    responses={503: {"description": "One or more enabled models are not loaded."}},
)
async def ready() -> JSONResponse:
    """Readiness probe -- 200 only when every enabled model is loaded, else 503.

    K8s readiness probes key on the status code, not the body, so a 200 here
    would route traffic to a pod with no working model (#37).
    """
    models_info = {info["name"]: info["status"] for info in registry.list_models()}
    is_ready = registry.all_ready()
    body = {
        "status": "ready" if is_ready else "loading",
        "models": models_info,
    }
    return JSONResponse(status_code=200 if is_ready else 503, content=body)
