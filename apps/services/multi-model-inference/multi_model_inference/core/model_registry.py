"""Singleton model registry for managing inference models."""

import logging
from typing import Any

from multi_model_inference.core.base_model import InferenceModel

logger = logging.getLogger(__name__)


class ModelRegistry:
    """Central registry for all inference models.

    Manages model lifecycle: registration, loading, access, and unloading.
    Designed as a singleton -- use the module-level `registry` instance.
    """

    def __init__(self) -> None:
        self._models: dict[str, InferenceModel] = {}

    def register(self, name: str, model: InferenceModel) -> None:
        """Register a model instance.

        Args:
            name: Unique identifier for the model.
            model: An instance of an InferenceModel subclass.
        """
        if name in self._models:
            logger.warning("Model '%s' already registered, replacing.", name)
        self._models[name] = model
        logger.info("Registered model: %s", name)

    def get(self, name: str) -> InferenceModel:
        """Get a registered model by name.

        Args:
            name: The model identifier.

        Returns:
            The model instance.

        Raises:
            KeyError: If the model is not registered.
        """
        if name not in self._models:
            raise KeyError(f"Model '{name}' is not registered.")
        return self._models[name]

    def load_all(self) -> None:
        """Load all registered models. Called during app startup."""
        for name, model in self._models.items():
            logger.info("Loading model: %s", name)
            try:
                model.load()
                logger.info("Model '%s' loaded successfully.", name)
            except Exception:
                logger.exception("Failed to load model '%s'.", name)

    def unload_all(self) -> None:
        """Unload all registered models. Called during app shutdown."""
        for name, model in self._models.items():
            logger.info("Unloading model: %s", name)
            try:
                model.unload()
            except Exception:
                logger.exception("Failed to unload model '%s'.", name)

    def list_models(self) -> list[dict[str, Any]]:
        """Return info for all registered models."""
        return [model.model_info() for model in self._models.values()]

    def all_ready(self) -> bool:
        """Check if all registered models are loaded and ready."""
        if not self._models:
            return True
        return all(model.is_ready for model in self._models.values())

    @property
    def model_names(self) -> list[str]:
        """List all registered model names."""
        return list(self._models.keys())


# Module-level singleton
registry = ModelRegistry()
