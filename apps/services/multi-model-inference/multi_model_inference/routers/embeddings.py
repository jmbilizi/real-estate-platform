"""Embeddings endpoint router."""

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from multi_model_inference.core.model_registry import registry
from multi_model_inference.core.readiness import DEGRADED, readiness_state
from multi_model_inference.models.sentence_embedder import MODEL_NAME
from multi_model_inference.schemas.embeddings import EmbeddingRequest, EmbeddingResponse

router = APIRouter(prefix="/api/v1", tags=["embeddings"])


@router.post("/embeddings", response_model=EmbeddingResponse)
async def create_embeddings(request: EmbeddingRequest) -> EmbeddingResponse:
    """Generate embeddings for the given text inputs.

    Uses the sentence-embedder model to produce dense vector representations
    suitable for semantic search, similarity comparison, and RAG pipelines.
    Inference runs in a thread pool to avoid blocking the async event loop.
    """
    try:
        model = registry.get(MODEL_NAME)
    except KeyError:
        raise HTTPException(
            status_code=503,
            detail=f"Model '{MODEL_NAME}' is not available.",
        ) from None

    if not model.is_ready:
        # Say which it is. In a degraded build the load already failed and nothing
        # retries it, so "still loading" would send the caller off to wait for an
        # event that never comes (#287).
        detail = (
            f"Model '{MODEL_NAME}' failed to load and is not available in this build."
            if readiness_state() == DEGRADED
            else f"Model '{MODEL_NAME}' is still loading."
        )
        raise HTTPException(status_code=503, detail=detail)

    embeddings = await run_in_threadpool(model.predict, request.input)

    return EmbeddingResponse(
        model=MODEL_NAME,
        embeddings=embeddings,
        dimension=len(embeddings[0]) if embeddings else 0,
        count=len(embeddings),
    )
