// <copyright file="TrustedClientIpExtensions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.HttpOverrides;

namespace ApiGateway.Extensions
{
    /// <summary>
    /// Derives the caller identity that Ocelot rate limits key on (#143).
    /// </summary>
    internal static class TrustedClientIpExtensions
    {
        /// <summary>
        /// Configuration key: comma-separated CIDR list of the proxies the gateway trusts to set
        /// <c>X-Forwarded-For</c>. Empty means no proxy is trusted and the transport peer is the client.
        /// </summary>
        internal const string TrustedProxyNetworksKey = "TRUSTED_PROXY_NETWORKS";

        private const string RealIpHeader = "X-Real-IP";

        /// <summary>
        /// Resolves the client IP from the transport peer, or from <c>X-Forwarded-For</c> when the
        /// peer is a trusted proxy. Then overwrites <c>X-Real-IP</c> with that value, so the header
        /// never carries a caller-supplied value into Ocelot or a downstream service.
        /// </summary>
        /// <param name="app">The application builder.</param>
        /// <param name="configuration">The configuration holding <see cref="TrustedProxyNetworksKey"/>.</param>
        /// <returns>The same builder.</returns>
        public static IApplicationBuilder UseTrustedClientIp(this IApplicationBuilder app, IConfiguration configuration)
        {
            var options = new ForwardedHeadersOptions
            {
                ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
                RequireHeaderSymmetry = false,

                // ingress-nginx sets one X-Forwarded-For hop (compute-full-forwarded-for is off).
                ForwardLimit = 1,
            };

            // The defaults trust loopback. Trust only what configuration names.
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            foreach (var entry in (configuration[TrustedProxyNetworksKey] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!System.Net.IPNetwork.TryParse(entry, out var network))
                {
                    throw new InvalidOperationException(
                        $"{TrustedProxyNetworksKey} contains '{entry}', which is not a CIDR network.");
                }

                options.KnownIPNetworks.Add(network);
            }

            // An empty trust list makes the middleware trust every peer, so skip it in that case.
            if (options.KnownIPNetworks.Count > 0)
            {
                app.UseForwardedHeaders(options);
            }

            return app.Use(async (context, next) =>
            {
                context.Request.Headers[RealIpHeader] =
                    context.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1";
                await next().ConfigureAwait(false);
            });
        }
    }
}
