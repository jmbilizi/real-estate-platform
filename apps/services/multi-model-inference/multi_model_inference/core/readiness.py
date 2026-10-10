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
FAILED = "failed"
DEGRADED = "degraded"


def readiness_state() -> str:
    """Return `ready`, `loading`, `failed`, or `degraded`.

    `loading` means `registry.load_all()` is running now. `failed` and `degraded`
    mean a model did not load and nothing retries it. `failed` is a defect: the
    image baked its weights, so `/ready` fails closed. `degraded` is expected: the
    weights were never baked in.
    """
    if registry.all_ready():
        return READY
    if registry.is_loading:
        return LOADING
    return FAILED if settings.model_load_required else DEGRADED
