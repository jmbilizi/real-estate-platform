"""Application configuration via environment variables."""

from pydantic import ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Inference service settings.

    All values can be overridden via environment variables.
    Example: ENABLED_MODELS='["sentence-embedder"]'
    """

    model_config = ConfigDict(env_prefix="", case_sensitive=False)

    # Service metadata
    app_name: str = "Inference Service"
    app_version: str = "1.0.0"

    # Model configuration
    enabled_models: list[str] = ["sentence-embedder"]
    model_cache_dir: str = "/opt/models"
    device: str = "cpu"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000


# Module-level singleton
settings = Settings()
