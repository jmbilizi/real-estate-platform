"""Tests for the root service-info endpoint."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app


def test_root_returns_service_info():
    """Root endpoint returns service metadata."""

    def _clear_registry():
        registry._models.clear()

    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_clear_registry,
        ),
        TestClient(app) as client,
    ):
        response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "service" in data
    assert "version" in data
    assert data["status"] in ("ready", "loading")
    assert "models" in data
    assert data["docs"] == "/docs"
