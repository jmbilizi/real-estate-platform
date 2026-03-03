"""Embeddings endpoint router."""

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from multi_model_inference.core.model_registry import registry
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
        raise HTTPException(
            status_code=503,
            detail=f"Model '{MODEL_NAME}' is still loading.",
        )

    embeddings = await run_in_threadpool(model.predict, request.input)

    return EmbeddingResponse(
        model=MODEL_NAME,
        embeddings=embeddings,
        dimension=len(embeddings[0]) if embeddings else 0,
        count=len(embeddings),
    )
