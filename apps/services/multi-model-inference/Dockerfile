# Build stage - install dependencies
ARG PYTHON_VERSION=3.11
FROM python:${PYTHON_VERSION}-slim AS build
WORKDIR /build

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

# Runtime stage - minimal image
ARG PYTHON_VERSION
FROM python:${PYTHON_VERSION}-slim AS final
WORKDIR /app

# Copy virtual environment from build stage
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Security: Create non-root user
RUN groupadd -r app && useradd -r -g app app && \
    mkdir -p /opt/models && \
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
