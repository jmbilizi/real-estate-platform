"""Sentence embedding model using fastembed (ONNX Runtime)."""

import logging
from typing import Any

from multi_model_inference.config import settings
from multi_model_inference.core.base_model import InferenceModel

logger = logging.getLogger(__name__)

# Model identifier used in config and registry
MODEL_NAME = "sentence-embedder"
MODEL_ID = "BAAI/bge-small-en-v1.5"
MODEL_DESCRIPTION = "Fast sentence embedding model (ONNX, ~50MB). Produces 384-dim vectors for semantic search, similarity, and RAG."


class SentenceEmbedder(InferenceModel):
    """Sentence embedding model backed by fastembed.

    Uses BAAI/bge-small-en-v1.5 via ONNX Runtime for fast CPU inference.
    Produces 384-dimensional embeddings suitable for semantic search.
    """

    def __init__(self) -> None:
        self._model = None
        self._loaded = False

    def load(self) -> None:
        """Download (if needed) and load the embedding model."""
        from fastembed import TextEmbedding

        logger.info("Loading model: %s (cache: %s)", MODEL_ID, settings.model_cache_dir)
        self._model = TextEmbedding(
            model_name=MODEL_ID,
            cache_dir=settings.model_cache_dir,
        )
        # Warm up with a dummy embedding
        list(self._model.embed(["warmup"]))
        self._loaded = True
        logger.info("Model %s loaded and warmed up.", MODEL_ID)

    def unload(self) -> None:
        """Release model resources."""
        self._model = None
        self._loaded = False
        logger.info("Model %s unloaded.", MODEL_ID)

    def predict(self, inputs: list[str]) -> list[list[float]]:
        """Generate embeddings for a list of text inputs.

        Args:
            inputs: List of text strings to embed.

        Returns:
            List of embedding vectors (each 384-dimensional).

        Raises:
            RuntimeError: If model is not loaded.
        """
        if not self._loaded or self._model is None:
            raise RuntimeError(f"Model '{MODEL_NAME}' is not loaded.")
        embeddings = list(self._model.embed(inputs))
        return [emb.tolist() for emb in embeddings]

    def model_info(self) -> dict[str, Any]:
        """Return model metadata."""
        return {
            "name": MODEL_NAME,
            "model_id": MODEL_ID,
            "description": MODEL_DESCRIPTION,
            "status": "loaded" if self._loaded else "not_loaded",
            "embedding_dimension": 384,
        }

    @property
    def is_ready(self) -> bool:
        """Whether the model is loaded and ready."""
        return self._loaded
