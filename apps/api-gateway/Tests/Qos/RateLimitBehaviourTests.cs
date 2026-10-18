// <copyright file="RateLimitBehaviourTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

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
using Newtonsoft.Json.Linq;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;
using Ocelot.Provider.Polly;
using Xunit;

namespace ApiGateway.Tests.Qos
{
    /// <summary>
    /// End-to-end proof that a request over a route's quota gets the documented 429 (#955).
    /// </summary>
    /// <remarks>
    /// Uses the real <c>GlobalConfiguration.RateLimitOptions</c> from <c>Ocelot.Settings.json</c>.
    /// Dev answered an over-quota read with an empty 500, so a config test alone is not enough.
    /// </remarks>
    [SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable", Justification = "xunit calls IAsyncLifetime.DisposeAsync for teardown.")]
    public sealed class RateLimitBehaviourTests : IAsyncLifetime
    {
        private const int Limit = 2;

        private IHost? downstream;
        private IHost? gateway;
        private HttpClient? client;

        /// <inheritdoc/>
        public async Task InitializeAsync()
        {
            downstream = await StartDownstreamAsync().ConfigureAwait(false);
            var port = new Uri(downstream.Services.GetRequiredService<IServer>().Features
                .Get<IServerAddressesFeature>()!.Addresses.First()).Port;
            gateway = await StartGatewayAsync(port).ConfigureAwait(false);
            client = gateway.GetTestClient();
        }

        /// <inheritdoc/>
        public async Task DisposeAsync()
        {
            client?.Dispose();
            foreach (var host in new[] { gateway, downstream })
            {
                if (host is not null)
                {
                    await host.StopAsync().ConfigureAwait(false);
                    host.Dispose();
                }
            }
        }

        [Fact]
        public async Task RequestOverQuota_ShouldGetThe429Envelope_AndARetryAfter()
        {
            for (var i = 0; i < Limit; i++)
            {
                using var ok = await GetAsync("203.0.113.7").ConfigureAwait(true);
                ((int)ok.StatusCode).Should().Be(200);
            }

            using var over = await GetAsync("203.0.113.7").ConfigureAwait(true);
            var body = await over.Content.ReadAsStringAsync().ConfigureAwait(true);

            ((int)over.StatusCode).Should().Be(RateLimitContract.StatusCode, "body was '{0}'", body);
            body.Should().Be(RateLimitContract.ResponseBody);
            over.Headers.Contains("Retry-After").Should().BeTrue();
        }

        [Fact]
        public async Task QuotaIsPerClient_SoOneClientOverQuotaNeverBlocksAnother()
        {
            for (var i = 0; i <= Limit; i++)
            {
                using var spent = await GetAsync("203.0.113.7").ConfigureAwait(true);
            }

            using var other = await GetAsync("198.51.100.9").ConfigureAwait(true);
            ((int)other.StatusCode).Should().Be(200);
        }

        private static JToken GlobalRateLimitOptions()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "apps", "api-gateway", "Configuration", "Ocelot.Settings.json");
                if (File.Exists(candidate))
                {
                    return JObject.Parse(File.ReadAllText(candidate))["GlobalConfiguration"]!["RateLimitOptions"]!;
                }

                directory = directory.Parent;
            }

            throw new DirectoryNotFoundException("Could not locate Ocelot.Settings.json.");
        }

        private static async Task<IHost> StartDownstreamAsync()
        {
            var host = new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseKestrel();
                    web.UseUrls("http://127.0.0.1:0");
                    web.Configure(app => app.Run(context => context.Response.WriteAsync("ok")));
                })
                .Build();
            await host.StartAsync().ConfigureAwait(false);
            return host;
        }

        private static async Task<IHost> StartGatewayAsync(int downstreamPort)
        {
            var ocelotJson = $$"""
            {
              "GlobalConfiguration": {
                "BaseUrl": "http://localhost",
                "RateLimitOptions": {{GlobalRateLimitOptions().ToString()}}
              },
              "Routes": [
                {
                  "UpstreamPathTemplate": "/downstream",
                  "UpstreamHttpMethod": [ "GET" ],
                  "DownstreamPathTemplate": "/ok",
                  "DownstreamScheme": "http",
                  "DownstreamHostAndPorts": [ { "Host": "127.0.0.1", "Port": {{downstreamPort.ToString(CultureInfo.InvariantCulture)}} } ],
                  "RateLimitOptions": {
                    "EnableRateLimiting": true,
                    "Period": "1m",
                    "PeriodTimespan": 60,
                    "Limit": {{Limit}}
                  }
                }
              ]
            }
            """;
            var configuration = new ConfigurationBuilder()
                .AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(ocelotJson)))
                .Build();

            return await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.ConfigureServices(services => services.AddOcelot(configuration).AddPolly());
                    web.Configure(app =>
                    {
                        app.UseMiddleware<UpstreamUnavailableMiddleware>();
                        app.UseOcelot().Wait();
                    });
                })
                .StartAsync()
                .ConfigureAwait(false);
        }

        private async Task<HttpResponseMessage> GetAsync(string clientIp)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/downstream", UriKind.Relative));
            request.Headers.Add("X-Real-IP", clientIp);
            return await client!.SendAsync(request).ConfigureAwait(false);
        }
    }
}
