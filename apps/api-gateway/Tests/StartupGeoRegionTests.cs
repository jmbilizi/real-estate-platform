// <copyright file="StartupGeoRegionTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using ApiGateway.Services;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace ApiGateway.Tests
{
    /// <summary>
    /// Unit tests for the logic behind <c>GET /geo/region</c> (#362).
    /// </summary>
    /// <remarks>
    /// <see cref="Startup.MapGeoRegion"/> is a pure function over <see cref="GeoLocationData"/>,
    /// so a known-IP result and a lookup miss are both testable directly, with no mock and no
    /// MaxMind database. <see cref="Startup.ResolveGeoRegion"/>'s gating (disabled / no client
    /// IP) is tested the same way <see cref="Services.GeoIpServiceTests"/> already does: a real
    /// <see cref="GeoIpService"/> built with <c>GEOIP_ENABLED=false</c>, rather than a mock.
    /// </remarks>
    public class StartupGeoRegionTests : IDisposable
    {
        private readonly GeoIpService disabledService;

        public StartupGeoRegionTests()
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { { "GEOIP_ENABLED", "false" } })
                .Build();
            disabledService = new GeoIpService(configuration, new Mock<ILogger<GeoIpService>>().Object);
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            disabledService.Dispose();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public void MapGeoRegion_WithKnownLocation_ReturnsCityRegionGranularityOnly()
        {
            // A known-IP lookup carries latitude/longitude/postal code too — the map must drop
            // them, matching the "no exact location" requirement.
            var location = new GeoLocationData
            {
                City = "Mountain View",
                Region = "California",
                RegionCode = "CA",
                CountryCode = "US",
                Latitude = 37.4056,
                Longitude = -122.0775,
                PostalCode = "94043",
            };

            var result = Startup.MapGeoRegion(location);

            result.Should().BeEquivalentTo(new GeoRegionResponse("Mountain View", "California", "CA", "US"));
        }

        [Fact]
        public void MapGeoRegion_WithNoLocation_ReturnsNull()
        {
            // A miss reaches here the same way regardless of its cause (private IP, unallocated
            // range) — GeoIpService.GetLocation already collapses all of them to null.
            Startup.MapGeoRegion(null).Should().BeNull();
        }

        [Fact]
        public void ResolveGeoRegion_WhenGeoIpDisabled_ReturnsNull()
        {
            Startup.ResolveGeoRegion(disabledService, "8.8.8.8").Should().BeNull();
        }

        [Fact]
        public void ResolveGeoRegion_WhenServiceIsNotRegistered_ReturnsNull()
        {
            Startup.ResolveGeoRegion(null, "8.8.8.8").Should().BeNull();
        }

        [Fact]
        public void ResolveGeoRegion_WithNoClientIp_ReturnsNull()
        {
            Startup.ResolveGeoRegion(disabledService, null).Should().BeNull();
        }

        [Fact]
        public void ResolveTrustedClientIp_ReadsXRealIp_IgnoringForgedXForwardedFor()
        {
            // Nginx Ingress always sets X-Real-IP from its own observed connection, so an
            // external caller cannot forge it there. X-Forwarded-For has no such guarantee, so a
            // forged value there must not change the result (#362).
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Real-IP"] = "203.0.113.7";
            context.Request.Headers["X-Forwarded-For"] = "8.8.8.8";

            Startup.ResolveTrustedClientIp(context.Request).Should().Be("203.0.113.7");
        }

        [Fact]
        public void ResolveTrustedClientIp_WithNoXRealIp_ReturnsNull()
        {
            var context = new DefaultHttpContext();

            Startup.ResolveTrustedClientIp(context.Request).Should().BeNull();
        }

        /// <summary>
        /// Confirms the route itself is wired up (host-level, not just the resolver logic
        /// above): a real request reaches <c>/geo/region</c> and gets a 204, not a 404 or 500,
        /// with GeoIP disabled — the state every environment without a MaxMind database is in.
        /// </summary>
        /// <returns>A task that completes when the assertion has run.</returns>
        [Fact]
        public async Task GeoRegionEndpoint_WithGeoIpDisabled_Returns204NoContent()
        {
            using var host = await StartGatewayHostAsync().ConfigureAwait(true);

            using HttpResponseMessage response = await GetGeoRegionAsync(host, "203.0.113.10").ConfigureAwait(true);

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        /// <summary>
        /// <c>/geo/region</c> bypasses Ocelot's per-route QoS (it is not an Ocelot route), so it
        /// carries its own rate limit. This proves that limit is actually wired up, not just
        /// configured (#362).
        /// </summary>
        /// <returns>A task that completes when the assertion has run.</returns>
        [Fact]
        public async Task GeoRegionEndpoint_OverRateLimit_Returns429()
        {
            using var host = await StartGatewayHostAsync().ConfigureAwait(true);
            const string clientIp = "203.0.113.20";

            HttpStatusCode? lastStatus = null;
            for (int i = 0; i < Startup.GeoRegionRateLimitPermits + 1; i++)
            {
                using HttpResponseMessage response = await GetGeoRegionAsync(host, clientIp).ConfigureAwait(true);
                lastStatus = response.StatusCode;
            }

            lastStatus.Should().Be(HttpStatusCode.TooManyRequests);
        }

        private static async Task<IHost> StartGatewayHostAsync()
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { { "GEOIP_ENABLED", "false" } })
                .Build();
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

        private static async Task<HttpResponseMessage> GetGeoRegionAsync(IHost host, string clientIp)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/geo/region", UriKind.Relative));
            request.Headers.Add("X-Real-IP", clientIp);
            return await host.GetTestClient().SendAsync(request).ConfigureAwait(true);
        }
    }
}
