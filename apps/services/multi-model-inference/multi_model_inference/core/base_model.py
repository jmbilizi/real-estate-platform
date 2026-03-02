"""Abstract base class for all inference models."""

from abc import ABC, abstractmethod
from typing import Any


class InferenceModel(ABC):
    """Abstract base for inference models.

    Every model must implement load(), predict(), and model_info().
    This ensures a consistent interface for the registry and routers.
    """

    @abstractmethod
    def load(self) -> None:
        """Load model weights and prepare for inference.

        Called once during application startup. Should be idempotent.
        """

    @abstractmethod
    def unload(self) -> None:
        """Release model resources.

        Called during application shutdown.
        """

    @abstractmethod
    def predict(self, inputs: Any) -> Any:
        """Run inference on the given inputs.

        Args:
            inputs: Model-specific input data.

        Returns:
            Model-specific output data.
        """

    @abstractmethod
    def model_info(self) -> dict[str, Any]:
        """Return metadata about the loaded model.

        Returns:
            Dictionary with at least: name, version, status, description.
        """

    @property
    @abstractmethod
    def is_ready(self) -> bool:
        """Whether the model is loaded and ready for inference."""
