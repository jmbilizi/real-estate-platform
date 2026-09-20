"""Tests for health and readiness endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app


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
    """Ready endpoint returns 503 when a registered model failed to load."""
    with (
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
