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

# Copy application source and install the package
COPY ["apps/services/multi-model-inference/multi_model_inference/", "multi_model_inference/"]
RUN pip install --no-cache-dir .

# Pre-download the ML model during build so the container starts offline.
# fastembed caches to /opt/models; at runtime it finds the files and skips
# the network call to HuggingFace entirely.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-small-en-v1.5', cache_dir='/opt/models')"

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
