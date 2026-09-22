"""Health and readiness check routers."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from multi_model_inference.core.model_registry import registry
from multi_model_inference.core.readiness import LOADING, readiness_state

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
    responses={503: {"description": "One or more required models are not loaded."}},
)
async def ready() -> JSONResponse:
    """Readiness probe -- 200 when every enabled model is loaded.

    K8s readiness probes key on the status code, not the body. A 200 with no
    working model would route traffic to a pod that cannot serve (#37), so a
    failed load fails closed whenever the weights were baked into the image.

    An image built without baked weights (`MODEL_LOAD_REQUIRED=false`, set from
    the Dockerfile's `PRE_DOWNLOAD_MODEL` arg) downloads at first startup, which
    cannot succeed on a network that blocks HuggingFace. Such a build reports
    `degraded` with a 200 rather than blocking a whole local deploy on a service
    that is not a priority (#287). The body still names the failed model, so the
    state is legible instead of a false claim of health.

    Reporting 200 here cannot mask a slow start: `registry.load_all()` runs to
    completion before the lifespan handler yields, so once this endpoint can be
    reached at all, "not ready" means failed rather than still loading.
    """
    models_info = {info["name"]: info["status"] for info in registry.list_models()}
    state = readiness_state()
    return JSONResponse(
        status_code=503 if state == LOADING else 200,
        content={"status": state, "models": models_info},
    )
