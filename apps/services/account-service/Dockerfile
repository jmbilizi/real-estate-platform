# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
ARG COPY_CERTS=false
WORKDIR /src

# Optional: Enterprise CA setup (local dev only, skipped in CI/CD)
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates; \
    else \
      echo "Skipping enterprise CA setup"; \
    fi

# Copy csproj and restore dependencies
COPY ["apps/services/account-service/account-service.csproj", "apps/services/account-service/"]
COPY [".editorconfig", "."]
COPY ["Directory.Build.props", "."]
COPY ["Directory.Build.targets", "."]
COPY ["Directory.Packages.props", "."]
COPY ["nuget.config", "."]
COPY ["global.json", "."]
RUN dotnet restore "apps/services/account-service/account-service.csproj"

# Copy source code and build
COPY ["apps/services/account-service/", "apps/services/account-service/"]
RUN dotnet build "apps/services/account-service/account-service.csproj" -c ${BUILD_CONFIGURATION} -o /app/build

# Publish stage
FROM build AS publish
RUN dotnet publish "apps/services/account-service/account-service.csproj" -c ${BUILD_CONFIGURATION} -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Copy published application
COPY --from=publish /app/publish .

# Security: Create non-root user and set ownership
RUN (groupadd -r app 2>/dev/null || true) && \
    (useradd -r -g app app 2>/dev/null || true) && \
    chown -R app:app /app
USER app

# Expose port
EXPOSE 8080

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0

ENTRYPOINT ["dotnet", "account-service.dll"]
