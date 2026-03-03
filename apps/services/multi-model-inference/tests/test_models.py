"""Tests for the models endpoint."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app
from tests.test_embeddings import FakeEmbedder


def test_list_models():
    """Models endpoint lists all registered models."""
    fake = FakeEmbedder()

    def _register():
        registry._models.clear()
        registry.register("sentence-embedder", fake)

    with patch(
        "multi_model_inference.main._register_models",
        side_effect=_register,
    ), TestClient(app) as client:
        response = client.get("/api/v1/models")
    assert response.status_code == 200
    data = response.json()
    assert len(data["models"]) == 1
    assert data["models"][0]["name"] == "sentence-embedder"
