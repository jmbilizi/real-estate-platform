// <copyright file="CircuitBreakerBehaviourTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text;
using ApiGateway.Middleware;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;
using Ocelot.Provider.Polly;
using Xunit;

namespace ApiGateway.Tests.Qos
{
    /// <summary>
    /// End-to-end proof that the gateway's QoS wiring times out a stalled downstream, opens the
    /// circuit breaker, and closes it again after the break (#52).
    /// </summary>
    /// <remarks>
    /// This exercises the real Ocelot + Polly pipeline against a real stalled HTTP server. It is
    /// the check that a <c>QoSOptions</c> block is enforced and not merely parsed, which is what a
    /// gateway with no <c>AddPolly()</c> registration silently does.
    /// </remarks>
    [SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable", Justification = "xunit calls IAsyncLifetime.DisposeAsync for teardown.")]
    public sealed class CircuitBreakerBehaviourTests : IAsyncLifetime
    {
        private const int TimeoutMs = 500;
        private const int BreakDurationMs = 2000;

        private readonly StallingDownstream downstream = new();
        private IHost? gateway;
        private HttpClient? client;

        /// <inheritdoc/>
        public async Task InitializeAsync()
        {
            await downstream.StartAsync().ConfigureAwait(false);
            gateway = await StartGatewayAsync(downstream.Port).ConfigureAwait(false);
            client = gateway.GetTestClient();
        }

        /// <inheritdoc/>
        public async Task DisposeAsync()
        {
            client?.Dispose();
            if (gateway is not null)
            {
                await gateway.StopAsync().ConfigureAwait(false);
                gateway.Dispose();
            }

            await downstream.DisposeAsync().ConfigureAwait(false);
        }

        [Fact]
        public async Task StalledDownstream_ShouldTimeOut_ThenOpenTheBreaker_ThenRecover()
        {
            var http = client!;

            // 1. A stalled downstream times out at TimeoutValue, not at Ocelot's 90-second default.
            var first = await TimedGetAsync(http).ConfigureAwait(true);
            first.Status.Should().Be(503);
            first.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5), "the timeout must fire well before the downstream answers");

            // 2. The second failure reaches MinimumThroughput and opens the circuit.
            var second = await TimedGetAsync(http).ConfigureAwait(true);
            second.Status.Should().Be(503);

            // 3. An open circuit fails immediately — no thread is held waiting on the downstream.
            var whileOpen = await TimedGetAsync(http).ConfigureAwait(true);
            whileOpen.Status.Should().Be(503);
            whileOpen.Elapsed.Should().BeLessThan(
                TimeSpan.FromMilliseconds(TimeoutMs),
                "an open breaker must reject without calling the downstream");

            // 4. Every degraded response carries the documented body.
            whileOpen.Body.Should().Be(UpstreamUnavailableMiddleware.ResponseBody);

            // 5. The downstream recovers, and the breaker closes again after the break.
            downstream.Healthy = true;
            await Task.Delay(BreakDurationMs + 1000).ConfigureAwait(true);

            var afterRecovery = await TimedGetAsync(http).ConfigureAwait(true);
            afterRecovery.Status.Should().Be(200);
        }

        private static async Task<(int Status, TimeSpan Elapsed, string Body)> TimedGetAsync(HttpClient http)
        {
            var stopwatch = Stopwatch.StartNew();
            using var response = await http.GetAsync(new Uri("/downstream", UriKind.Relative)).ConfigureAwait(false);
            stopwatch.Stop();
            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return ((int)response.StatusCode, stopwatch.Elapsed, body);
        }

        private static async Task<IHost> StartGatewayAsync(int downstreamPort)
        {
            var ocelotJson = BuildOcelotConfiguration(downstreamPort);
            var ocelotConfiguration = new ConfigurationBuilder()
                .AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(ocelotJson)))
                .Build();

            var host = await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.ConfigureServices(services => services.AddOcelot(ocelotConfiguration).AddPolly());
                    web.Configure(app =>
                    {
                        app.UseMiddleware<UpstreamUnavailableMiddleware>();
                        app.UseOcelot().Wait();
                    });
                })
                .StartAsync()
                .ConfigureAwait(false);

            return host;
        }

        private static string BuildOcelotConfiguration(int downstreamPort) =>
            $$"""
            {
              "GlobalConfiguration": { "BaseUrl": "http://localhost" },
              "Routes": [
                {
                  "UpstreamPathTemplate": "/downstream",
                  "UpstreamHttpMethod": [ "GET" ],
                  "DownstreamPathTemplate": "/stall",
                  "DownstreamScheme": "http",
                  "DownstreamHostAndPorts": [ { "Host": "127.0.0.1", "Port": {{downstreamPort.ToString(CultureInfo.InvariantCulture)}} } ],
                  "QoSOptions": {
                    "Timeout": {{TimeoutMs}},
                    "MinimumThroughput": 2,
                    "FailureRatio": 0.5,
                    "SamplingDuration": 20000,
                    "BreakDuration": {{BreakDurationMs}}
                  }
                }
              ]
            }
            """;

        /// <summary>
        /// A real HTTP server that stalls past the gateway's timeout until <see cref="Healthy"/>
        /// is set. TestServer cannot stand in for it: Ocelot calls the downstream over a socket.
        /// </summary>
        private sealed class StallingDownstream : IAsyncDisposable
        {
            private IHost? host;

            /// <summary>Gets or sets a value indicating whether the stub answers at once.</summary>
            public bool Healthy { get; set; }

            /// <summary>Gets the port the stub listens on.</summary>
            public int Port { get; private set; }

            public async Task StartAsync()
            {
                host = new HostBuilder()
                    .ConfigureLogging(logging => logging.ClearProviders())
                    .ConfigureWebHost(web =>
                    {
                        web.UseKestrel();
                        web.UseUrls("http://127.0.0.1:0");
                        web.Configure(app => app.Run(async context =>
                        {
                            if (!Healthy)
                            {
                                try
                                {
                                    await Task.Delay(TimeSpan.FromSeconds(30), context.RequestAborted).ConfigureAwait(false);
                                }
                                catch (OperationCanceledException)
                                {
                                    // The gateway timed out and dropped the call. Expected.
                                    return;
                                }
                            }

                            context.Response.StatusCode = 200;
                            await context.Response.WriteAsync("ok").ConfigureAwait(false);
                        }));
                    })
                    .Build();

                await host.StartAsync().ConfigureAwait(false);

                var addresses = host.Services.GetRequiredService<IServer>().Features
                    .Get<IServerAddressesFeature>()!.Addresses;
                Port = new Uri(addresses.First()).Port;
            }

            public async ValueTask DisposeAsync()
            {
                if (host is not null)
                {
                    await host.StopAsync().ConfigureAwait(false);
                    host.Dispose();
                }
            }
        }
    }
}
