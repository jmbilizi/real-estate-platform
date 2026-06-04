"""Tests for the embeddings endpoint."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from multi_model_inference.core.model_registry import registry
from multi_model_inference.main import app


class FakeEmbedder:
    """Fake sentence embedder for testing without loading real models."""

    def __init__(self):
        self._loaded = False

    def load(self):
        self._loaded = True

    def unload(self):
        self._loaded = False

    def predict(self, inputs):
        # Return deterministic fake embeddings (3-dim for simplicity)
        return [[0.1, 0.2, 0.3] for _ in inputs]

    def model_info(self):
        return {
            "name": "sentence-embedder",
            "model_id": "fake/test-model",
            "description": "Fake model for testing",
            "status": "loaded" if self._loaded else "not_loaded",
            "embedding_dimension": 3,
        }

    @property
    def is_ready(self):
        return self._loaded


def _make_client_with_fake_model():
    """Create a test client with a fake model registered."""
    fake = FakeEmbedder()

    def _register():
        registry._models.clear()
        registry.register("sentence-embedder", fake)

    # Must use patch as context manager around TestClient context manager
    # so the patch is active when lifespan runs (on __enter__)
    return patch("multi_model_inference.main._register_models", side_effect=_register)


def test_embeddings_success():
    """Embeddings endpoint returns vectors for valid input."""
    with _make_client_with_fake_model(), TestClient(app) as client:
        response = client.post(
            "/api/v1/embeddings",
            json={"input": ["hello world"]},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "sentence-embedder"
    assert data["count"] == 1
    assert data["dimension"] == 3
    assert len(data["embeddings"]) == 1
    assert len(data["embeddings"][0]) == 3


def test_embeddings_multiple_inputs():
    """Embeddings endpoint handles multiple inputs."""
    with _make_client_with_fake_model(), TestClient(app) as client:
        response = client.post(
            "/api/v1/embeddings",
            json={"input": ["text one", "text two", "text three"]},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 3
    assert len(data["embeddings"]) == 3


def test_embeddings_empty_input_rejected():
    """Empty input list is rejected with 422."""
    with _make_client_with_fake_model(), TestClient(app) as client:
        response = client.post("/api/v1/embeddings", json={"input": []})
    assert response.status_code == 422


def test_embeddings_oversized_string_rejected():
    """A single string exceeding 8192 chars is rejected with 422."""
    with _make_client_with_fake_model(), TestClient(app) as client:
        response = client.post(
            "/api/v1/embeddings",
            json={"input": ["x" * 9000]},
        )
    assert response.status_code == 422
    assert "maximum length" in response.json()["detail"][0]["msg"]


def test_embeddings_model_not_loaded():
    """Returns 503 when model is registered but not loaded."""
    fake = FakeEmbedder()  # not loaded

    def _register():
        registry._models.clear()
        registry.register("sentence-embedder", fake)

    # Don't load -- simulate startup failure
    with (
        patch(
            "multi_model_inference.main._register_models",
            side_effect=_register,
        ),
        patch.object(registry, "load_all"),
        TestClient(app) as client,
    ):
        response = client.post(
            "/api/v1/embeddings",
            json={"input": ["test"]},
        )
    assert response.status_code == 503
