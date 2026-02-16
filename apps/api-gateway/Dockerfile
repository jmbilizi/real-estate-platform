# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
ARG COPY_CERTS=false
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

# Security: Create non-root user and set ownership
# Note: Check if group/user already exists (dotnet:10 base images may pre-create them)
RUN (groupadd -r app 2>/dev/null || true) && \
    (useradd -r -g app app 2>/dev/null || true) && \
    chown -R app:app /app
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
