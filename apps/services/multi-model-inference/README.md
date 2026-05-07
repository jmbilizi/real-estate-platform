# Multi-Model Inference Service

A config-driven ML inference microservice built with **FastAPI** and **ONNX Runtime**. Serves
multiple models behind a unified REST API with async-safe inference, health probes, and a pluggable
model registry.

## Architecture

```
POST /api/v1/embeddings ──► Router ──► ModelRegistry ──► SentenceEmbedder (ONNX)
GET  /api/v1/models     ──► Router ──► ModelRegistry ──► model_info()
GET  /health            ──► Liveness probe (always ok)
GET  /ready             ──► Readiness probe (checks all models loaded)
GET  /                  ──► Service metadata
```

**Key design decisions:**

- **Model registry pattern** — models register at startup via a singleton registry. New model types
  implement the `InferenceModel` ABC and are added to the model map in `main.py`.
- **Config-driven loading** — `ENABLED_MODELS` env var controls which models load. Disabled models
  consume zero resources.
- **Async-safe inference** — ONNX `predict()` runs in `run_in_threadpool()` to avoid blocking the
  event loop.
- **Lifespan management** — models load during FastAPI lifespan startup and unload on shutdown.

## Loaded Models

| Name                | Model ID                 | Dimensions | Size   | Runtime    |
| ------------------- | ------------------------ | ---------- | ------ | ---------- |
| `sentence-embedder` | `BAAI/bge-small-en-v1.5` | 384        | ~50 MB | ONNX (CPU) |

## Quick Start

### Local Development

```bash
# From the workspace root — installs all deps into shared .venv
pnpm run python:env

# Run with hot-reload via Nx
pnpm run nx:python-dev

# Or directly with uvicorn
uv run uvicorn multi_model_inference.main:app --reload --port 8000
```

The service starts at `http://localhost:8000`. Interactive docs at `/docs`.

### Run Tests

```bash
# Via Nx (all Python projects)
pnpm run nx:python-test

# Directly (from workspace root)
uv run pytest apps/services/multi-model-inference/tests -v
```

18 tests covering model registry, embeddings, health probes, input validation, and service info.

## API Reference

### `POST /api/v1/embeddings`

Generate embeddings for one or more text inputs.

**Request:**

```json
{
  "input": ["Luxury apartment in downtown", "Cozy studio near park"],
  "model": "sentence-embedder"
}
```

**Response:**

```json
{
  "model": "sentence-embedder",
  "embeddings": [
    { "index": 0, "values": [0.0123, -0.0456, ...] },
    { "index": 1, "values": [0.0789, -0.0012, ...] }
  ],
  "usage": { "input_count": 2 }
}
```

**Validation:**

- `input` — non-empty list of non-empty strings, max 8192 characters each
- `model` — defaults to `"sentence-embedder"` if omitted

### `GET /api/v1/models`

List all registered models and their status.

### `GET /health`

Liveness probe — returns `{"status": "ok"}` if the process is running.

### `GET /ready`

Readiness probe — returns `{"status": "ready"}` only when all models are loaded.

### `GET /`

Service metadata: name, version, status, loaded model count, docs URL.

## Configuration

All settings are configurable via environment variables (no prefix):

| Variable          | Default                         | Description                                 |
| ----------------- | ------------------------------- | ------------------------------------------- |
| `ENABLED_MODELS`  | `["sentence-embedder"]`         | JSON list of model names to load at startup |
| `MODEL_CACHE_DIR` | `/opt/models`                   | Directory for downloaded model weights      |
| `DEVICE`          | `cpu`                           | Inference device (`cpu`)                    |
| `APP_NAME`        | `Multi-Model Inference Service` | Service name in metadata                    |
| `APP_VERSION`     | `1.0.0`                         | Service version in metadata                 |
| `HOST`            | `0.0.0.0`                       | Uvicorn bind host                           |
| `PORT`            | `8000`                          | Uvicorn bind port                           |

## Adding a New Model

1. Create a class implementing `InferenceModel` in `models/`:

   ```python
   from multi_model_inference.core.base_model import InferenceModel

   class MyModel(InferenceModel):
       def load(self) -> None: ...
       def unload(self) -> None: ...
       def predict(self, payload: Any) -> Any: ...
       def model_info(self) -> dict[str, Any]: ...
       @property
       def is_ready(self) -> bool: ...
   ```

2. Register it in the `model_map` in `main.py`:

   ```python
   model_map: dict[str, Callable[[], InferenceModel]] = {
       "sentence-embedder": lambda: SentenceEmbedder(),
       "my-model": lambda: MyModel(),  # add here
   }
   ```

3. Add a router in `routers/` if the model needs a custom endpoint, or reuse the embeddings router.

4. Enable it: `ENABLED_MODELS='["sentence-embedder", "my-model"]'`

## Docker

```bash
# Build (from workspace root — uses .dockerignore)
docker build -f apps/services/multi-model-inference/Dockerfile -t multi-model-inference .

# Run
docker run -p 8000:8000 multi-model-inference
```

The Dockerfile uses a multi-stage build (Python 3.11 slim), runs as non-root, and includes a health
check with a 60-second start period for model downloading.

## Project Structure

```
multi-model-inference/
├── multi_model_inference/
│   ├── main.py              # FastAPI app, lifespan, model registration
│   ├── config.py            # Pydantic Settings (env vars)
│   ├── core/
│   │   ├── base_model.py    # InferenceModel ABC
│   │   └── model_registry.py # Singleton model registry
│   ├── models/
│   │   └── sentence_embedder.py  # fastembed ONNX wrapper
│   ├── routers/
│   │   ├── info.py          # GET / service metadata
│   │   ├── health.py        # /health + /ready probes
│   │   ├── models.py        # GET /api/v1/models
│   │   └── embeddings.py    # POST /api/v1/embeddings
│   └── schemas/
│       └── embeddings.py    # Request/response Pydantic models
├── tests/                   # 18 unit tests
├── Dockerfile               # Multi-stage production build
├── pyproject.toml           # Dependencies + tool config
└── project.json             # Nx project configuration
```

## Tech Stack

- **FastAPI** — async HTTP framework
- **fastembed** — ONNX Runtime wrapper for embedding models
- **Pydantic v2** — request validation + settings
- **UV** — package management (workspace mode)
- **pytest** — testing with coverage
