// <copyright file="StartupTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace ApiGateway.Tests
{
    /// <summary>
    /// Host-startup tests for <see cref="Startup"/> (#170).
    /// <para>
    /// The gateway crashed at startup whenever <c>ConfigureOpenTelemetry</c> returned early, because
    /// <c>Configure</c> called <c>UseOpenTelemetryPrometheusScrapingEndpoint()</c> unconditionally
    /// and that resolves a <c>MeterProvider</c> which was never registered. Two paths return early:
    /// <c>OTEL_ENABLED=false</c>, and an <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> that fails URI validation.
    /// </para>
    /// <para>
    /// These start a real host, because the defect only appears when the full pipeline runs.
    /// Constructing <see cref="Startup"/> or reading configuration proves nothing — an earlier
    /// version of this file did exactly that and passed with the fix reverted.
    /// </para>
    /// <para>
    /// ONE <see cref="Startup"/> instance spans both phases on purpose. The flag the fix sets lives
    /// on the instance, so a test that built a second instance for <c>Configure</c> would not be
    /// exercising the fix at all.
    /// </para>
    /// </summary>
    public class StartupTests
    {
        /// <summary>
        /// The host starts when tracing is switched off. Without the fix this throws.
        /// </summary>
        /// <returns>A task that completes when the assertion has run.</returns>
        [Fact]
        public async Task GatewayHost_WithOtelDisabled_StartsSuccessfully()
        {
            using var host = await StartHostAsync(new Dictionary<string, string?>
            {
                { "OTEL_ENABLED", "false" },
            }).ConfigureAwait(true);

            host.GetTestClient().Should().NotBeNull();
        }

        /// <summary>
        /// The host starts when the OTLP endpoint is malformed. Without the fix this throws.
        /// </summary>
        /// <returns>A task that completes when the assertion has run.</returns>
        [Fact]
        public async Task GatewayHost_WithInvalidOtlpEndpoint_StartsSuccessfully()
        {
            using var host = await StartHostAsync(new Dictionary<string, string?>
            {
                { "OTEL_ENABLED", "true" },
                { "OTEL_EXPORTER_OTLP_ENDPOINT", "not-a-valid-uri" },
            }).ConfigureAwait(true);

            host.GetTestClient().Should().NotBeNull();
        }

        /// <summary>
        /// Starts a test host driven by the real <see cref="Startup"/>.
        /// </summary>
        /// <param name="settings">Configuration values for this case.</param>
        /// <returns>The started host.</returns>
        private static async Task<IHost> StartHostAsync(Dictionary<string, string?> settings)
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(settings)
                .Build();

            // One instance across both phases — see the class remarks.
            var startup = new Startup(configuration);

            return await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.ConfigureServices(startup.ConfigureServices);
                    web.Configure(app =>
                        startup.Configure(
                            app,
                            app.ApplicationServices.GetRequiredService<IWebHostEnvironment>()));
                })
                .StartAsync()
                .ConfigureAwait(true);
        }
    }
}
