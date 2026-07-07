# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
ARG COPY_CERTS=false
ARG MAXMIND_LICENSE_KEY=""
WORKDIR /src

# Optional: Enterprise CA setup (local dev only, skipped in CI/CD)
# The .workspace-certs directory is auto-generated for local development only
# and used when building behind corporate proxies with SSL inspection.
# In CI/CD, this step is skipped as GitHub Actions doesn't require custom CAs.
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      echo "Installing enterprise CA certificates for local development..." && \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates && \
      echo "Enterprise CA certificates installed successfully"; \
    else \
      echo "Skipping enterprise CA setup (CI/CD mode or certs not available)"; \
    fi

# Copy csproj and restore dependencies
COPY ["apps/api-gateway/api-gateway.csproj", "apps/api-gateway/"]
COPY ["apps/api-gateway/.editorconfig", "apps/api-gateway/"]
COPY [".editorconfig", "."]
COPY ["Directory.Build.props", "."]
COPY ["Directory.Build.targets", "."]
COPY ["Directory.Packages.props", "."]
COPY ["nuget.config", "."]
COPY ["global.json", "."]
RUN dotnet restore "apps/api-gateway/api-gateway.csproj" --verbosity detailed

# Copy source code and build
COPY ["apps/api-gateway/", "apps/api-gateway/"]
RUN dotnet build "apps/api-gateway/api-gateway.csproj" -c ${BUILD_CONFIGURATION} -o /app/build

# Publish stage
FROM build AS publish
RUN dotnet publish "apps/api-gateway/api-gateway.csproj" -c ${BUILD_CONFIGURATION} -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Copy published application
COPY --from=publish /app/publish .

# Create Configuration directory structure
RUN mkdir -p Configuration/Routes

# Create GeoIP directory and copy database
RUN mkdir -p /opt/geoip
# Download GeoLite2-City database (optional - required for geographic enrichment)
# If MAXMIND_LICENSE_KEY is provided, download the database
# Otherwise, log a warning and continue (GeoIP features will be disabled)
ARG MAXMIND_LICENSE_KEY=""
RUN if [ -n "$MAXMIND_LICENSE_KEY" ]; then \
      echo "Downloading GeoLite2-City database..."; \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
      curl -L "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
        -o /tmp/GeoLite2-City.tar.gz && \
      tar -xzf /tmp/GeoLite2-City.tar.gz -C /tmp && \
      find /tmp -name "GeoLite2-City.mmdb" -exec mv {} /opt/geoip/GeoLite2-City.mmdb \; && \
      rm -rf /tmp/GeoLite2-City.tar.gz /tmp/GeoLite2-City_* && \
      apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* && \
      echo "GeoLite2-City database installed successfully"; \
    else \
      echo "WARNING: MAXMIND_LICENSE_KEY not provided - GeoIP features will be unavailable"; \
      echo "To enable GeoIP: Set build arg MAXMIND_LICENSE_KEY or manually copy GeoLite2-City.mmdb"; \
      echo "For local dev: Skaffold will sync the file at runtime from apps/api-gateway/GeoLite2-City.mmdb"; \
    fi

# Note: GeoLite2-City.mmdb is NOT copied during build for these reasons:
# - CI/CD: Downloaded above using MAXMIND_LICENSE_KEY (file is gitignored)
# - Local dev: Skaffold syncs file after container starts (see skaffold.yaml)
# - Manual builds: Either provide license key OR file sync/volume mount at runtime

# Security: Create non-root user and set ownership
# Note: Check if group/user already exists (dotnet:10 base images may pre-create them)
RUN (groupadd -r app 2>/dev/null || true) && \
    (useradd -r -g app app 2>/dev/null || true) && \
    chown -R app:app /app && \
    chown -R app:app /opt/geoip
USER app

# Expose ports
EXPOSE 8080
EXPOSE 8081

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail http://localhost:8080/health || exit 1

ENTRYPOINT ["dotnet", "api-gateway.dll"]
