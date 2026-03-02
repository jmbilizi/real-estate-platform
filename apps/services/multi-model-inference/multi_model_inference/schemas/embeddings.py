"""Request/response schemas for the embeddings endpoint."""

from pydantic import BaseModel, Field, model_validator


class EmbeddingRequest(BaseModel):
    """Request body for generating embeddings."""

    input: list[str] = Field(
        ...,
        min_length=1,
        max_length=256,
        description="List of text strings to embed (1-256 items, max 8192 chars each).",
        json_schema_extra={"examples": [["Find me a 3-bedroom house near good schools"]]},
    )

    @model_validator(mode="after")
    def _validate_input_lengths(self) -> "EmbeddingRequest":
        """Reject inputs with excessively long strings."""
        max_chars = 8192
        for i, text in enumerate(self.input):
            if len(text) > max_chars:
                raise ValueError(
                    f"Input[{i}] exceeds maximum length of {max_chars} characters ({len(text)} given)."
                )
        return self


class EmbeddingResponse(BaseModel):
    """Response body containing generated embeddings."""

    model: str = Field(description="Model used for embedding generation.")
    embeddings: list[list[float]] = Field(description="List of embedding vectors.")
    dimension: int = Field(description="Dimensionality of each embedding vector.")
    count: int = Field(description="Number of embeddings returned.")
