// <copyright file="InternalRoutesNotExposedTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards that no live route reaches an <c>/internal/*</c> service endpoint (#628).
    /// </summary>
    /// <remarks>
    /// <c>POST /internal/account/introspect</c> now returns roles and email. It must stay reachable only
    /// from inside the cluster. Ocelot matches by upstream template, so a route is exposed if its upstream
    /// or downstream template can reach <c>/internal</c>, or if an upstream template is a root catch-all.
    /// </remarks>
    public class InternalRoutesNotExposedTests
    {
        private static readonly string GatewayRoot = FindGatewayRoot();

        [Fact]
        public void NoLiveRoute_ShouldExposeInternalPaths()
        {
            var routeFiles = Directory.GetFiles(Path.Combine(GatewayRoot, "Configuration", "Routes"), "*.json");
            routeFiles.Should().NotBeEmpty();

            var offenders = new List<string>();
            foreach (var file in routeFiles)
            {
                var routes = JObject.Parse(File.ReadAllText(file))["Routes"] as JArray ?? new JArray();
                foreach (var route in routes)
                {
                    var upstream = (string?)route["UpstreamPathTemplate"] ?? string.Empty;
                    var downstream = (string?)route["DownstreamPathTemplate"] ?? string.Empty;

                    var upstreamExposes = upstream.StartsWith("/internal", StringComparison.OrdinalIgnoreCase)
                        || upstream.StartsWith("/{", StringComparison.Ordinal);
                    var downstreamReaches = downstream.StartsWith("/internal", StringComparison.OrdinalIgnoreCase);

                    if (upstreamExposes || downstreamReaches)
                    {
                        offenders.Add($"{Path.GetFileName(file)}: {upstream} -> {downstream}");
                    }
                }
            }

            offenders.Should().BeEmpty("the introspection endpoint must stay in-cluster only");
        }

        private static string FindGatewayRoot()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "apps", "api-gateway", "api-gateway.csproj");
                if (File.Exists(candidate))
                {
                    return Path.GetDirectoryName(candidate)!;
                }

                directory = directory.Parent;
            }

            throw new DirectoryNotFoundException("Could not locate the api-gateway project directory.");
        }
    }
}
