// <copyright file="Startup.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;
using System.Text;
using ApiGateway.Extensions;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;
using OpenTelemetry.Exporter;
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
            app.UseCors("CORSPolicy");

            app.UseHttpsRedirection();

            app.UseRouting();

            app.UseAuthorization();

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
                });
        }
    }
}
