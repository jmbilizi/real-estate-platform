// <copyright file="TrustedClientIpTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using ApiGateway.Extensions;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace ApiGateway.Tests.Extensions
{
    /// <summary>
    /// Proves the gateway derives <c>X-Real-IP</c> and never trusts the caller's value (#143).
    /// Ocelot buckets every rate limit on <c>X-Real-IP</c> (<c>ClientIdHeader</c>), so the value
    /// the next middleware sees is the bucket key.
    /// </summary>
    public class TrustedClientIpTests
    {
        private const string Peer = "203.0.113.9";
        private const string ProxyNetwork = "10.244.0.0/16";
        private const string ProxyAddress = "10.244.1.5";

        [Fact]
        public async Task UntrustedPeer_OverwritesSuppliedXRealIp()
        {
            var seen = await SendAsync(Peer, ProxyNetwork, new() { ["X-Real-IP"] = "1.2.3.4" }).ConfigureAwait(true);

            seen.Should().Be(Peer);
        }

        [Fact]
        public async Task UntrustedPeer_IgnoresXForwardedFor()
        {
            var seen = await SendAsync(Peer, ProxyNetwork, new() { ["X-Forwarded-For"] = "1.2.3.4" }).ConfigureAwait(true);

            seen.Should().Be(Peer);
        }

        [Fact]
        public async Task NoTrustedNetworkConfigured_UsesPeerEvenFromLoopback()
        {
            var seen = await SendAsync("127.0.0.1", null, new() { ["X-Forwarded-For"] = "1.2.3.4" }).ConfigureAwait(true);

            seen.Should().Be("127.0.0.1");
        }

        [Fact]
        public async Task TrustedProxy_UsesForwardedClientAndDiscardsSuppliedXRealIp()
        {
            var seen = await SendAsync(
                ProxyAddress,
                ProxyNetwork,
                new() { ["X-Forwarded-For"] = "198.51.100.7", ["X-Real-IP"] = "1.2.3.4" }).ConfigureAwait(true);

            seen.Should().Be("198.51.100.7");
        }

        [Fact]
        public async Task RepeatedXRealIpHeaders_CollapseToOneValue()
        {
            var seen = await SendAsync(Peer, ProxyNetwork, new() { ["X-Real-IP"] = "1.1.1.1, 2.2.2.2" }).ConfigureAwait(true);

            seen.Should().Be(Peer);
        }

        [Fact]
        public async Task VaryingXRealIp_AlwaysYieldsTheSameRateLimitKey()
        {
            var keys = new HashSet<string>();
            for (var i = 0; i < 20; i++)
            {
                keys.Add(await SendAsync(Peer, ProxyNetwork, new() { ["X-Real-IP"] = $"10.9.8.{i}" }).ConfigureAwait(true));
            }

            keys.Should().ContainSingle().Which.Should().Be(Peer);
        }

        [Fact]
        public async Task MalformedNetwork_FailsFast()
        {
            var act = () => SendAsync(Peer, "not-a-cidr", new());

            await act.Should().ThrowAsync<InvalidOperationException>().ConfigureAwait(true);
        }

        private static async Task<string> SendAsync(
            string peer,
            string? trustedNetworks,
            Dictionary<string, string> headers)
        {
            var settings = new Dictionary<string, string?>();
            if (trustedNetworks is not null)
            {
                settings[TrustedClientIpExtensions.TrustedProxyNetworksKey] = trustedNetworks;
            }

            var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

            using var host = await new HostBuilder()
                .ConfigureLogging(logging => logging.ClearProviders())
                .ConfigureWebHost(web =>
                {
                    web.UseTestServer();
                    web.Configure(app =>
                    {
                        app.Use((context, next) =>
                        {
                            context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                            return next();
                        });
                        app.UseTrustedClientIp(configuration);
                        app.Run(context => context.Response.WriteAsync(context.Request.Headers["X-Real-IP"].ToString()));
                    });
                })
                .StartAsync()
                .ConfigureAwait(true);

            using var request = new HttpRequestMessage(HttpMethod.Get, "/");
            foreach (var (name, value) in headers)
            {
                request.Headers.TryAddWithoutValidation(name, value);
            }

            var response = await host.GetTestClient().SendAsync(request).ConfigureAwait(true);
            return await response.Content.ReadAsStringAsync().ConfigureAwait(true);
        }
    }
}
