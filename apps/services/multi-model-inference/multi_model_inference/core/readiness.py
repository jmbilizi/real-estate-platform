"""Single definition of the service's readiness state.

`/ready`, `/` and the embedding endpoints all report model state. They must never
disagree: a pod that passes its readiness probe while another endpoint claims a load
is in progress sends whoever is triaging it in the wrong direction (#287). Each of
them derives its wording from `readiness_state()` rather than re-deriving the rule.
"""

from multi_model_inference.config import settings
from multi_model_inference.core.model_registry import registry

READY = "ready"
LOADING = "loading"
DEGRADED = "degraded"


def readiness_state() -> str:
    """Return `ready`, `loading`, or `degraded`.

    `degraded` means a model failed to load and this image does not require it,
    because the weights were never baked in. Nothing is still in progress in that
    state and nothing retries the load, so reporting `loading` would be false.
    """
    if registry.all_ready():
        return READY
    return LOADING if settings.model_load_required else DEGRADED
