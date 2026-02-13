# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy workspace CA bundle to BOTH system and .NET trusted root locations
COPY [".workspace-certs/workspace-enterprise-roots.pem", "/usr/local/share/ca-certificates/workspace-enterprise-roots.crt"]
COPY [".workspace-certs/workspace-enterprise-roots.pem", "/usr/share/dotnet/sdk/10.0.102/trustedroots/workspace-roots.pem"]

# Update certificate trust store
RUN update-ca-certificates

# Configure .NET to use custom CA bundle
ENV DOTNET_SSL_CERT_FILE=/usr/share/dotnet/sdk/10.0.102/trustedroots/workspace-roots.pem \
    DOTNET_SYSTEM_NET_HTTP_USESOCKETSHTTPHANDLER=0

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
RUN dotnet build "apps/api-gateway/api-gateway.csproj" -c Release -o /app/build

# Publish stage
FROM build AS publish
RUN dotnet publish "apps/api-gateway/api-gateway.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Copy published application
COPY --from=publish /app/publish .

# Create Configuration directory structure
RUN mkdir -p Configuration/Routes

# Expose ports
EXPOSE 8080
EXPOSE 8081

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "api-gateway.dll"]
