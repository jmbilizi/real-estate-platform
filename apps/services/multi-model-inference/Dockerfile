# Build stage - install dependencies
ARG PYTHON_VERSION=3.11
FROM python:${PYTHON_VERSION}-slim AS build
ARG COPY_CERTS=false
WORKDIR /build

# Optional: Enterprise CA setup (local dev only, skipped in CI/CD)
# The .workspace-certs directory is auto-generated for local development only
# and used when building behind corporate proxies with SSL inspection.
# In CI/CD, this step is skipped as GitHub Actions doesn't require custom CAs.
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      echo "Installing enterprise CA certificates for local development..." && \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates && \
      rm -rf /var/lib/apt/lists/* && \
      echo "Enterprise CA certificates installed successfully"; \
    else \
      echo "Skipping enterprise CA setup (CI/CD mode or certs not available)"; \
    fi

# Point pip/Python SSL to the system cert store (includes custom CAs when installed).
# Harmless in CI/CD — the file exists in the base image with default CAs.
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    PIP_CERT=/etc/ssl/certs/ca-certificates.crt

# Install dependencies into a virtual environment for clean copy
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only dependency definition first (cache layer)
COPY ["apps/services/multi-model-inference/pyproject.toml", "."]
COPY ["apps/services/multi-model-inference/README.md", "."]

# Install production dependencies only
RUN pip install --no-cache-dir .

# Pre-download the ML model during build so the container starts offline.
# fastembed caches to /opt/models; at runtime it finds the files and skips
# the network call to HuggingFace entirely.
# Set PRE_DOWNLOAD_MODEL=false for local dev when HuggingFace is unreachable
# (e.g. behind a corporate proxy). The model will be downloaded at first startup instead.
#
# This deliberately sits BEFORE the application source is copied. It depends only on the
# dependency install, so an app-code change no longer invalidates it — previously it was the
# last layer, so every source edit re-fetched the weights from HuggingFace and put the build
# back in the path of the rate limiter below for no reason.
#
# MODEL_ID must match sentence_embedder.py's MODEL_ID, and the cache dir must match
# config.py's model_cache_dir default: if either drifts, the weights are baked into the image
# but not found at runtime, and the service silently falls back to downloading at startup.
ARG PRE_DOWNLOAD_MODEL=true
ARG MODEL_ID=BAAI/bge-small-en-v1.5
# HuggingFace rate-limits anonymous downloads per source IP, and GitHub-hosted runners share
# their egress IPs with the rest of the world — so a 429 here is a routine event, not a defect
# in the build. fastembed's own retry gives up after ~40s, which is not long enough to outlast
# one. Retry over ~8 minutes before failing.
#
# The failure stays FATAL on purpose. Swallowing it would produce an image that builds green,
# ships with no weights, and then reports itself ready while every embedding request 503s.
RUN set -eu; \
    if [ "$PRE_DOWNLOAD_MODEL" != "true" ]; then \
      echo "Skipping model pre-download (PRE_DOWNLOAD_MODEL=false) - model will download at first startup"; \
      mkdir -p /opt/models; \
    else \
      for backoff in 15 45 120 300 give-up; do \
        if python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='${MODEL_ID}', cache_dir='/opt/models')"; then \
          break; \
        fi; \
        if [ "$backoff" = give-up ]; then \
          echo "ERROR: could not fetch ${MODEL_ID} after 5 attempts (HuggingFace rate limit or outage)." >&2; \
          exit 1; \
        fi; \
        echo "Model fetch failed; retrying in ${backoff}s..."; \
        sleep "$backoff"; \
      done; \
      test -n "$(ls -A /opt/models)"; \
    fi

# Copy application source and install the package
COPY ["apps/services/multi-model-inference/multi_model_inference/", "multi_model_inference/"]
RUN pip install --no-cache-dir .

# Runtime stage - minimal image
ARG PYTHON_VERSION
FROM python:${PYTHON_VERSION}-slim AS final
WORKDIR /app

# Copy virtual environment from build stage
COPY --from=build /opt/venv /opt/venv
# Copy pre-downloaded model weights from build stage (offline startup)
COPY --from=build /opt/models /opt/models
ENV PATH="/opt/venv/bin:$PATH"

# Security: Create non-root user
RUN groupadd -r app && useradd -r -g app app && \
    chown -R app:app /app /opt/models
USER app

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run with uvicorn
ENTRYPOINT ["uvicorn", "multi_model_inference.main:app", "--host", "0.0.0.0", "--port", "8000"]
