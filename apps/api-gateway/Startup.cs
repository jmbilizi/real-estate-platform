// <copyright file="Startup.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using ApiGateway.Extensions;
using ApiGateway.Services;
using Microsoft.AspNetCore.HttpOverrides;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;
using OpenTelemetry.Exporter;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace ApiGateway
{
    /// <summary>
    /// Startup class for configuring the API Gateway services and middleware.
    /// </summary>
    [SuppressMessage("Performance", "CA1515:Consider making public types internal", Justification = "Used by ASP.NET Core via reflection")]
    public class Startup
    {
        // LoggerMessage delegates for performance (CA1848)
        private static readonly Action<ILogger, Exception?> LogTracingDisabledAction =
            LoggerMessage.Define(
                LogLevel.Warning,
                new EventId(1, "TracingDisabled"),
                "OpenTelemetry tracing is DISABLED for this environment");

        private static readonly Action<ILogger, string, Exception?> LogInvalidEndpointAction =
            LoggerMessage.Define<string>(
                LogLevel.Error,
                new EventId(2, "InvalidEndpoint"),
                "Invalid OTEL_EXPORTER_OTLP_ENDPOINT: {Endpoint}. Tracing disabled.");

        private static readonly Action<ILogger, string, string, string, double, string, Exception?> LogOpenTelemetryConfiguredAction =
            LoggerMessage.Define<string, string, string, double, string>(
                LogLevel.Information,
                new EventId(3, "OpenTelemetryConfigured"),
                "OpenTelemetry configured: Endpoint={Endpoint}, Service={Service}, Sampler={Sampler}:{Rate}, Pod={Pod}");

        /// <summary>
        /// Initializes a new instance of the <see cref="Startup"/> class.
        /// </summary>
        /// <param name="configuration">The application configuration.</param>
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        /// <summary>
        /// Gets the application configuration.
        /// </summary>
        public IConfiguration Configuration { get; }

        /// <summary>
        /// Configures the application services.
        /// </summary>
        /// <param name="services">The service collection.</param>
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddCors(options =>
            {
                options.AddPolicy(
                    "CORSPolicy",
                    builder => builder
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials()
                        .SetIsOriginAllowed((hosts) => true));
            });

            services.AddControllers();

            // Add health checks
            services.AddHealthChecks();

            services.AddEndpointsApiExplorer();

            // Register GeoIP service as singleton (thread-safe, one database reader for app lifetime)
            services.AddSingleton<GeoIpService>();

            // Configure OpenTelemetry (conditional based on environment)
            ConfigureOpenTelemetry(services);

            string serviceRoutesFolderPath = "Configuration/Routes";

            string baseOcelotConfigurationFilePath = "Configuration/Ocelot.Settings.json";

            string ocelotConfigurationJsonString = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(serviceRoutesFolderPath, baseOcelotConfigurationFilePath);

            MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(ocelotConfigurationJsonString));

            IConfigurationRoot configuration = new ConfigurationBuilder().AddJsonStream(stream).Build();

            services.AddOcelot(configuration);

            // Add services for Swagger generation
            services.AddSwaggerGen();

            services.AddSwaggerForOcelot(configuration, option =>
            {
                option.GenerateDocsForGatewayItSelf = true;
            });
        }

        /// <summary>
        /// Configures the HTTP request pipeline.
        /// </summary>
        /// <param name="app">The application builder.</param>
        /// <param name="env">The web host environment.</param>
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            // Configure forwarded headers (X-Forwarded-For from Nginx Ingress or direct testing)
            var forwardedHeadersOptions = new ForwardedHeadersOptions
            {
                ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
                RequireHeaderSymmetry = false, // Allow X-Forwarded-For without X-Forwarded-Host
                ForwardLimit = null, // Allow unlimited proxies for local testing
            };

            // For local development: accept forwarded headers from any source
            if (env.IsDevelopment())
            {
                forwardedHeadersOptions.KnownProxies.Clear();
                forwardedHeadersOptions.KnownIPNetworks.Clear();
            }

            app.UseForwardedHeaders(forwardedHeadersOptions);

            app.UseCors("CORSPolicy");

            app.UseHttpsRedirection();

            app.UseRouting();

            app.UseAuthorization();

            // OpenTelemetry Prometheus exporter middleware (must be between UseRouting and UseEndpoints)
            app.UseOpenTelemetryPrometheusScrapingEndpoint();

            app.UseEndpoints(endpoints =>
            {
                // Redirect root URL/Request to Swagger UI
                endpoints.MapGet("/", context =>
                {
                    context.Response.Redirect("/swagger", permanent: false);
                    return Task.CompletedTask;
                });

                endpoints.MapControllers();

                // Health check endpoints (must be before Ocelot middleware)
                endpoints.MapHealthChecks("/health/live");
                endpoints.MapHealthChecks("/health/ready");
            });

            app.UseSwaggerForOcelotUI(option =>
            {
                option.PathToSwaggerGenerator = "/swagger/docs";
            });

            app.UseOcelot().Wait();
        }

        private static void LogTracingDisabled(ILogger logger) =>
            LogTracingDisabledAction(logger, null);

        private static void LogInvalidEndpoint(ILogger logger, string endpoint) =>
            LogInvalidEndpointAction(logger, endpoint, null);

        private static void LogOpenTelemetryConfigured(
            ILogger logger,
            string endpoint,
            string service,
            string sampler,
            double rate,
            string pod) =>
            LogOpenTelemetryConfiguredAction(logger, endpoint, service, sampler, rate, pod, null);

        /// <summary>
        /// Enriches OpenTelemetry activity with privacy-compliant request origin metadata.
        /// </summary>
        /// <param name="activity">The activity to enrich.</param>
        /// <param name="request">The HTTP request.</param>
        /// <param name="storeFullIp">Whether to store full IP (dev only) or hashed only (production).</param>
        /// <param name="salt">Salt for IP hashing.</param>
        /// <param name="geoIpService">Optional GeoIP service for location lookups.</param>
        private static void EnrichWithRequestOrigin(System.Diagnostics.Activity activity, HttpRequest request, bool storeFullIp, string salt, GeoIpService? geoIpService = null)
        {
            // Respect Do-Not-Track header (privacy compliance)
            if (request.Headers["DNT"].FirstOrDefault() == "1")
            {
                activity.SetTag("privacy.dnt", "true");
                return; // Skip detailed tracking
            }

            // Extract client IP (consider X-Forwarded-For from Nginx Ingress)
            string? clientIp = ExtractClientIp(request);

            if (!string.IsNullOrEmpty(clientIp))
            {
                // Privacy-compliant: Always store hashed IP for GDPR compliance
                string hashedIp = HashIpAddress(clientIp, salt);
                activity.SetTag("client.address_hash", hashedIp);

                // Development only: Store full IP for debugging (short Jaeger retention)
                if (storeFullIp)
                {
                    activity.SetTag("client.address", clientIp);
                }

                // Store IP type classification (no PII risk)
                activity.SetTag("client.ip_type", ClassifyIpType(clientIp));

                // GeoIP enrichment (if service available and enabled)
                if (geoIpService?.IsEnabled == true)
                {
                    var geoData = geoIpService.GetLocation(clientIp);
                    if (geoData.HasValue)
                    {
                        var geo = geoData.Value;

                        // Add geographic tags (OpenTelemetry semantic conventions)
                        if (!string.IsNullOrEmpty(geo.CountryCode))
                        {
                            activity.SetTag("client.geo.country_code", geo.CountryCode);
                        }

                        if (!string.IsNullOrEmpty(geo.CountryName))
                        {
                            activity.SetTag("client.geo.country_name", geo.CountryName);
                        }

                        if (!string.IsNullOrEmpty(geo.City))
                        {
                            activity.SetTag("client.geo.city", geo.City);
                        }

                        if (!string.IsNullOrEmpty(geo.Region))
                        {
                            activity.SetTag("client.geo.region", geo.Region);
                        }

                        if (!string.IsNullOrEmpty(geo.ContinentCode))
                        {
                            activity.SetTag("client.geo.continent_code", geo.ContinentCode);
                        }

                        if (geo.Latitude.HasValue)
                        {
                            activity.SetTag("client.geo.latitude", geo.Latitude.Value);
                        }

                        if (geo.Longitude.HasValue)
                        {
                            activity.SetTag("client.geo.longitude", geo.Longitude.Value);
                        }

                        if (!string.IsNullOrEmpty(geo.TimeZone))
                        {
                            activity.SetTag("client.geo.timezone", geo.TimeZone);
                        }
                    }
                }
            }

            // Network peer info (direct connection, not necessarily client)
            string? peerIp = request.HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrEmpty(peerIp))
            {
                activity.SetTag("network.peer.address", peerIp);
                activity.SetTag("network.peer.port", request.HttpContext.Connection.RemotePort);
            }

            // User agent (useful for bot detection, client type analysis)
            string? userAgent = request.Headers["User-Agent"].FirstOrDefault();
            if (!string.IsNullOrEmpty(userAgent))
            {
                activity.SetTag("http.user_agent", userAgent);

                // Classify user agent (privacy-safe aggregation)
                activity.SetTag("client.type", ClassifyUserAgent(userAgent));
            }

            // Referrer (where the request came from)
            string? referrer = request.Headers["Referer"].FirstOrDefault();
            if (!string.IsNullOrEmpty(referrer))
            {
                activity.SetTag("http.referer", referrer);
            }

            // Accept-Language (user's locale preference)
            string? acceptLanguage = request.Headers["Accept-Language"].FirstOrDefault();
            if (!string.IsNullOrEmpty(acceptLanguage))
            {
                // Extract primary language only (e.g., "en-US,en;q=0.9" -> "en-US")
                string primaryLanguage = acceptLanguage.Split(',')[0].Trim();
                activity.SetTag("http.accept_language", primaryLanguage);
            }

            // Proxy headers from Nginx Ingress (load balancer info)
            string? forwardedProto = request.Headers["X-Forwarded-Proto"].FirstOrDefault();
            if (!string.IsNullOrEmpty(forwardedProto))
            {
                activity.SetTag("http.x_forwarded_proto", forwardedProto);
            }

            string? realIp = request.Headers["X-Real-IP"].FirstOrDefault();
            if (!string.IsNullOrEmpty(realIp))
            {
                activity.SetTag("http.x_real_ip", realIp);
            }

            // TLS/Protocol info (security auditing)
            activity.SetTag("network.protocol.name", request.Protocol);
            activity.SetTag("tls.established", request.IsHttps);
        }

        /// <summary>
        /// Extracts the real client IP address from request headers and connection info.
        /// </summary>
        /// <param name="request">The HTTP request.</param>
        /// <returns>Client IP address or null if not available.</returns>
        private static string? ExtractClientIp(HttpRequest request)
        {
            // Priority 1: X-Forwarded-For (set by Nginx Ingress, may contain proxy chain)
            string? forwardedFor = request.Headers["X-Forwarded-For"].FirstOrDefault();
            if (!string.IsNullOrEmpty(forwardedFor))
            {
                // Take first IP in chain (original client)
                // Format: "client, proxy1, proxy2"
                return forwardedFor.Split(',')[0].Trim();
            }

            // Priority 2: X-Real-IP (set by some reverse proxies)
            string? realIp = request.Headers["X-Real-IP"].FirstOrDefault();
            if (!string.IsNullOrEmpty(realIp))
            {
                return realIp;
            }

            // Priority 3: Direct connection IP (no proxy)
            return request.HttpContext.Connection.RemoteIpAddress?.ToString();
        }

        /// <summary>
        /// Hashes IP address with salt for privacy compliance (GDPR Article 4).
        /// </summary>
        /// <param name="ipAddress">The IP address to hash.</param>
        /// <param name="salt">Salt for hashing (should be stored in Kubernetes secret).</param>
        /// <returns>Base64-encoded SHA256 hash.</returns>
        private static string HashIpAddress(string ipAddress, string salt)
        {
            string input = ipAddress + salt;
            byte[] inputBytes = Encoding.UTF8.GetBytes(input);
            byte[] hashBytes = SHA256.HashData(inputBytes);
            return Convert.ToBase64String(hashBytes);
        }

        /// <summary>
        /// Classifies IP address type (public/private/loopback) - no PII risk.
        /// </summary>
        /// <param name="ipAddress">The IP address to classify.</param>
        /// <returns>IP type classification.</returns>
        private static string ClassifyIpType(string ipAddress)
        {
            if (ipAddress.StartsWith("127.", StringComparison.Ordinal) ||
                ipAddress.Equals("::1", StringComparison.Ordinal))
            {
                return "loopback";
            }

            if (ipAddress.StartsWith("10.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("192.168.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.16.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.17.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.18.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.19.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.20.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.21.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.22.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.23.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.24.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.25.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.26.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.27.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.28.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.29.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.30.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("172.31.", StringComparison.Ordinal) ||
                ipAddress.StartsWith("fc00:", StringComparison.Ordinal) ||
                ipAddress.StartsWith("fd00:", StringComparison.Ordinal))
            {
                return "private";
            }

            return "public";
        }

        /// <summary>
        /// Classifies user agent into high-level category (privacy-safe aggregation).
        /// </summary>
        /// <param name="userAgent">The user agent string.</param>
        /// <returns>Client type classification.</returns>
        [SuppressMessage("Globalization", "CA1308:Normalize strings to uppercase", Justification = "User agent strings are conventionally compared in lowercase")]
        private static string ClassifyUserAgent(string userAgent)
        {
            string ua = userAgent.ToLowerInvariant();

            // Bot detection (common crawlers)
            if (ua.Contains("bot", StringComparison.Ordinal) || ua.Contains("crawler", StringComparison.Ordinal) || ua.Contains("spider", StringComparison.Ordinal) ||
                ua.Contains("googlebot", StringComparison.Ordinal) || ua.Contains("bingbot", StringComparison.Ordinal) || ua.Contains("slurp", StringComparison.Ordinal))
            {
                return "bot";
            }

            // Mobile devices
            if (ua.Contains("mobile", StringComparison.Ordinal) || ua.Contains("android", StringComparison.Ordinal) || ua.Contains("iphone", StringComparison.Ordinal) ||
                ua.Contains("ipad", StringComparison.Ordinal) || ua.Contains("ipod", StringComparison.Ordinal))
            {
                return "mobile";
            }

            // Browsers
            if (ua.Contains("chrome", StringComparison.Ordinal) || ua.Contains("firefox", StringComparison.Ordinal) || ua.Contains("safari", StringComparison.Ordinal) ||
                ua.Contains("edge", StringComparison.Ordinal) || ua.Contains("opera", StringComparison.Ordinal))
            {
                return "browser";
            }

            // API clients
            if (ua.Contains("curl", StringComparison.Ordinal) || ua.Contains("wget", StringComparison.Ordinal) || ua.Contains("postman", StringComparison.Ordinal) ||
                ua.Contains("insomnia", StringComparison.Ordinal) || ua.Contains("axios", StringComparison.Ordinal) || ua.Contains("fetch", StringComparison.Ordinal))
            {
                return "api_client";
            }

            return "unknown";
        }

        /// <summary>
        /// Configures OpenTelemetry tracing with environment-based toggle.
        /// </summary>
        /// <param name="services">The service collection.</param>
        private void ConfigureOpenTelemetry(IServiceCollection services)
        {
            // Read OTEL_ENABLED from environment (OTEL = OpenTelemetry, defaults to true)
            bool otelEnabled = Configuration.GetValue("OTEL_ENABLED", true);

            // Build logger for startup visibility
            ILogger<Startup> logger = services.BuildServiceProvider().GetRequiredService<ILogger<Startup>>();

            if (!otelEnabled)
            {
                LogTracingDisabled(logger);
                return;
            }

            // Get configuration from environment variables (set in Kubernetes)
            // Using standard OpenTelemetry environment variable names
            string otlpEndpoint = Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://jaeger-svc:4317";
            string serviceName = Configuration["OTEL_SERVICE_NAME"] ?? "api-gateway";
            string sampler = Configuration["OTEL_TRACES_SAMPLER"] ?? "traceidratio";
            double samplerArg = Configuration.GetValue("OTEL_TRACES_SAMPLER_ARG", 1.0);
            string environment = Configuration["ASPNETCORE_ENVIRONMENT"] ?? "Production";

            // Get Kubernetes metadata from downward API (injected via deployment YAML)
            string podName = Configuration["K8S_POD_NAME"] ?? Environment.MachineName;
            string podNamespace = Configuration["K8S_NAMESPACE_NAME"] ?? "default";
            string nodeName = Configuration["K8S_NODE_NAME"] ?? "unknown";

            // Privacy settings for IP tracking
            bool storeFullIp = Configuration.GetValue("OTEL_STORE_FULL_IP", environment.Equals("Development", StringComparison.OrdinalIgnoreCase));
            string ipHashSalt = Configuration["OTEL_IP_HASH_SALT"] ?? "change-this-in-production-k8s-secret";

            // Validate OTLP endpoint
            if (!Uri.TryCreate(otlpEndpoint, UriKind.Absolute, out Uri? endpoint))
            {
                LogInvalidEndpoint(logger, otlpEndpoint);
                return;
            }

            LogOpenTelemetryConfigured(
                logger,
                endpoint.ToString(),
                serviceName,
                sampler.ToUpperInvariant(),
                samplerArg,
                podName);

            services.AddOpenTelemetry()
                .ConfigureResource(resource =>
                {
                    resource.AddService(
                        serviceName: serviceName,
                        serviceVersion: typeof(Startup).Assembly.GetName().Version?.ToString() ?? "unknown")
                        .AddAttributes(
                            new Dictionary<string, object>
                            {
                                ["deployment.environment"] = environment.ToUpperInvariant(),
                                ["service.instance.id"] = podName,
                                ["k8s.pod.name"] = podName,
                                ["k8s.namespace.name"] = podNamespace,
                                ["k8s.node.name"] = nodeName,
                            });
                })
                .WithTracing(tracing =>
                {
                    tracing

                        // Instrument incoming HTTP requests to the gateway
                        .AddAspNetCoreInstrumentation(options =>
                        {
                            options.RecordException = true;
                            options.Filter = httpContext =>
                            {
                                // Don't trace health checks to reduce noise
                                return !httpContext.Request.Path.StartsWithSegments("/health", StringComparison.Ordinal);
                            };

                            // Enrich spans with privacy-compliant request origin metadata
                            options.EnrichWithHttpRequest = (activity, request) =>
                            {
                                // Get GeoIpService from HttpContext (proper DI resolution)
                                GeoIpService? geoIpService = request.HttpContext.RequestServices.GetService<GeoIpService>();
                                EnrichWithRequestOrigin(activity, request, storeFullIp, ipHashSalt, geoIpService);
                            };
                        })

                        // Instrument outgoing HTTP requests from Ocelot to downstream services
                        .AddHttpClientInstrumentation(options =>
                        {
                            options.RecordException = true;
                        })

                        // Configure sampler based on environment
                        .SetSampler(sampler.ToUpperInvariant() switch
                        {
                            "ALWAYS_ON" => new AlwaysOnSampler(),
                            "ALWAYS_OFF" => new AlwaysOffSampler(),
                            "TRACEIDRATIO" => new TraceIdRatioBasedSampler(samplerArg),
                            _ => new TraceIdRatioBasedSampler(samplerArg),
                        })

                        // Export to Jaeger via OTLP (batch export is default in 1.15.0)
                        .AddOtlpExporter(options =>
                        {
                            options.Endpoint = endpoint;
                            options.Protocol = OtlpExportProtocol.Grpc; // Use gRPC (port 4317) - 2.5x faster than HTTP
                        });
                })
                .WithMetrics(metrics =>
                {
                    metrics

                        // Instrument ASP.NET Core metrics (request duration, active requests, etc.)
                        .AddAspNetCoreInstrumentation()

                        // Instrument HTTP client metrics (outgoing request duration, failures, etc.)
                        .AddHttpClientInstrumentation()

                        // Instrument .NET runtime metrics (GC, thread pool, exceptions, etc.)
                        .AddRuntimeInstrumentation()

                        // Export to Prometheus (scrape endpoint at /metrics)
                        .AddPrometheusExporter();
                });
        }
    }
}
