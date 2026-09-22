"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Inference service settings.

    All values can be overridden via environment variables.
    Example: ENABLED_MODELS='["sentence-embedder"]'
    """

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    # Service metadata
    app_name: str = "Inference Service"
    app_version: str = "1.0.0"

    # Model configuration
    enabled_models: list[str] = ["sentence-embedder"]
    model_cache_dir: str = "/opt/models"
    device: str = "cpu"

    # Whether a model that fails to load makes the service unready.
    #
    # The Dockerfile sets this from its PRE_DOWNLOAD_MODEL build arg, so it answers
    # exactly one question: were the weights baked into this image? When they were, a
    # load failure is a real defect and /ready fails closed (#37). Local images are
    # built with PRE_DOWNLOAD_MODEL=false and fetch the weights at first startup, which
    # cannot succeed on a network that blocks HuggingFace; those come up degraded
    # instead of holding up the whole local deploy (#287).
    #
    # Defaults to True so an image that says nothing fails closed.
    model_load_required: bool = True

    # Server
    host: str = "0.0.0.0"
    port: int = 8000


# Module-level singleton
settings = Settings()
