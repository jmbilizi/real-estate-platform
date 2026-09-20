// <copyright file="StartupTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Ocelot.DependencyInjection;
using Xunit;

namespace ApiGateway.Tests
{
    /// <summary>
    /// Tests for the gateway startup configuration.
    /// Regression test for issue #170: the gateway crashed on startup when OTEL_ENABLED=false
    /// or when OTEL_EXPORTER_OTLP_ENDPOINT was invalid, because Configure called
    /// UseOpenTelemetryPrometheusScrapingEndpoint() unconditionally without verifying that
    /// MeterProvider was actually registered. The fix conditionally registers the endpoint only
    /// when ConfigureOpenTelemetry successfully completes.
    /// </summary>
    public class StartupTests
    {
        /// <summary>
        /// Verifies that the gateway host starts successfully when OTEL_ENABLED=false.
        /// Without the fix, this would crash when Configure() calls
        /// UseOpenTelemetryPrometheusScrapingEndpoint() unconditionally.
        /// </summary>
        [Fact]
        public async Task GatewayHost_WithOtelDisabled_StartsSuccessfully()
        {
            // Arrange
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "OTEL_ENABLED", "false" },
                })
                .Build();

            // Act — start the host; this would crash before the fix
            using var host = await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.ConfigureServices(services =>
                    {
                        // Minimal Ocelot setup to exercise the gateway startup path
                        services.AddOcelot(configuration).AddPolly();
                    });
                    web.Configure(app =>
                    {
                        var startup = new Startup(configuration);
                        startup.ConfigureServices(services);
                        startup.Configure(app);
                    });
                })
                .StartAsync();

            // Assert — the host should start without throwing
            host.Should().NotBeNull();
            var client = host.GetTestClient();
            client.Should().NotBeNull();
        }

        /// <summary>
        /// Verifies that the gateway host starts successfully with an invalid OTLP endpoint.
        /// ConfigureOpenTelemetry should detect the invalid endpoint, set _otelEnabled=false,
        /// and Configure() should skip registering the Prometheus endpoint, avoiding the crash.
        /// </summary>
        [Fact]
        public async Task GatewayHost_WithInvalidOtlpEndpoint_StartsSuccessfully()
        {
            // Arrange
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "OTEL_ENABLED", "true" },
                    { "OTEL_EXPORTER_OTLP_ENDPOINT", "not-a-valid-uri" },
                })
                .Build();

            // Act — start the host; this would crash before the fix
            using var host = await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.ConfigureServices(services =>
                    {
                        services.AddOcelot(configuration).AddPolly();
                    });
                    web.Configure(app =>
                    {
                        var startup = new Startup(configuration);
                        startup.ConfigureServices(services);
                        startup.Configure(app);
                    });
                })
                .StartAsync();

            // Assert — the host should start without throwing
            host.Should().NotBeNull();
            var client = host.GetTestClient();
            client.Should().NotBeNull();
        }
    }
}
