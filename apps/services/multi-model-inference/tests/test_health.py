"""Tests for health and readiness endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app


def _clear_registry():
    """Clear the singleton registry to isolate tests."""
    registry._models.clear()


def test_health_returns_ok():
    """Health endpoint always returns ok."""
    with patch(
        "multi_model_inference.main._register_models",
        side_effect=_clear_registry,
    ), TestClient(app) as c:
        response = c.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_when_no_models():
    """Ready endpoint returns ready when no models are configured."""
    with patch(
        "multi_model_inference.main._register_models",
        side_effect=_clear_registry,
    ), TestClient(app) as c:
        response = c.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["models"] == {}
