"""Tests for health and readiness endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.config import Settings, settings
from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app
from multi_model_inference.models.sentence_embedder import MODEL_NAME


class _FakeModel:
    """Minimal model stub for isolating router behavior from real weights."""

    def __init__(self, loaded: bool) -> None:
        self._loaded = loaded

    def load(self) -> None:
        if not self._loaded:
            raise RuntimeError("Simulated load failure")

    def unload(self) -> None:
        self._loaded = False

    def predict(self, inputs):
        return inputs

    def model_info(self):
        return {"name": "fake", "status": "loaded" if self._loaded else "not_loaded"}

    @property
    def is_ready(self) -> bool:
        return self._loaded


def _clear_registry():
    """Clear the singleton registry to isolate tests."""
    registry._models.clear()


def _register_not_loaded():
    """Register one model that fails to load, isolating the registry."""
    _clear_registry()
    registry.register("fake", _FakeModel(loaded=False))


def _register_loaded():
    """Register one model that loads successfully, isolating the registry."""
    _clear_registry()
    registry.register("fake", _FakeModel(loaded=True))


def _register_real_name_not_loaded():
    """Register a failing stub under the real model name.

    The embeddings endpoint looks the model up by `MODEL_NAME`, so a stub named
    anything else hits the "not available" branch instead of the state under test.
    """
    _clear_registry()
    registry.register(MODEL_NAME, _FakeModel(loaded=False))


def test_health_returns_ok():
    """Health endpoint always returns ok."""
    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_clear_registry,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_returns_ok_when_model_not_ready():
    """Health stays 200 even when a model failed to load (liveness != readiness)."""
    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_when_no_models():
    """Ready endpoint returns ready when no models are configured."""
    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_clear_registry,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["models"] == {}


def test_ready_returns_503_when_model_not_loaded():
    """Ready endpoint returns 503 when a registered model failed to load.

    This is the default contract: an image that says nothing about whether its
    weights are baked must fail closed (#37).
    """
    with (
        patch.object(settings, "model_load_required", True),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "loading"
    assert data["models"] == {"fake": "not_loaded"}


def test_model_load_required_defaults_to_true():
    """An image that sets no MODEL_LOAD_REQUIRED fails closed, never degraded.

    Assert the declared default, not the singleton. `settings` is built from the
    process environment at import, so reading it here would pass only because the
    host happens not to export the variable -- and would fail when the suite runs
    inside the locally built image, which sets it to false.
    """
    assert Settings.model_fields["model_load_required"].default is True


def test_ready_returns_200_degraded_when_model_optional_and_not_loaded():
    """A build with no baked weights comes up degraded rather than blocking.

    Local images are built with PRE_DOWNLOAD_MODEL=false, so the weights are
    absent by design and the runtime download can fail on a network that blocks
    HuggingFace. That must not hold up a local deploy (#287).
    """
    with (
        patch.object(settings, "model_load_required", False),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "degraded"
    assert data["models"] == {"fake": "not_loaded"}


def test_ready_reports_ready_not_degraded_when_optional_model_loads():
    """`degraded` reflects actual model state, not merely that it was optional."""
    with (
        patch.object(settings, "model_load_required", False),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["models"] == {"fake": "loaded"}


def test_ready_returns_200_when_all_models_loaded():
    """Ready endpoint returns 200 when every registered model is loaded."""
    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["models"] == {"fake": "loaded"}


def test_service_info_reports_degraded_not_loading():
    """`/` must not claim a load is in progress once it has permanently failed.

    A pod that passes its readiness probe while `/` says "loading" misdirects
    whoever is triaging it (#287).
    """
    with (
        patch.object(settings, "model_load_required", False),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


def test_embeddings_say_failed_not_loading_when_degraded():
    """The 503 body distinguishes a permanent failure from a load in progress."""
    with (
        patch.object(settings, "model_load_required", False),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_real_name_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.post("/api/v1/embeddings", json={"input": ["hello"]})
    assert response.status_code == 503
    assert "failed to load" in response.json()["detail"]


def test_embeddings_say_loading_when_load_is_required():
    """A required build keeps the loading wording, so #37's contract is unchanged."""
    with (
        patch.object(settings, "model_load_required", True),
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register_real_name_not_loaded,
        ),
        TestClient(app) as c,
    ):
        response = c.post("/api/v1/embeddings", json={"input": ["hello"]})
    assert response.status_code == 503
    assert "still loading" in response.json()["detail"]
