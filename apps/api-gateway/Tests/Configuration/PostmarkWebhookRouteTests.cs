// <copyright file="PostmarkWebhookRouteTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards the public route Postmark calls (#664). The account service holds the webhook at
    /// <c>/account/webhooks/postmark</c>, behind HTTP Basic credentials. The route is not under
    /// <c>/internal</c>, which <see cref="InternalRoutesNotExposedTests"/> keeps closed.
    /// </summary>
    public class PostmarkWebhookRouteTests
    {
        private const string WebhookPath = "/account/webhooks/postmark";

        [Fact]
        public void TheWebhook_HasItsOwnPostOnlyRoute_WithItsOwnRateLimit()
        {
            var route = Routes().Single(r => (string?)r["UpstreamPathTemplate"] == WebhookPath);

            route["UpstreamHttpMethod"]!.Select(m => (string?)m).Should().Equal("POST");
            ((string?)route["DownstreamPathTemplate"]).Should().Be(WebhookPath);
            ((string?)route["DownstreamHostAndPorts"]![0]!["Host"]).Should().Be("account-service-svc");
            ((bool?)route["RateLimitOptions"]!["EnableRateLimiting"]).Should().BeTrue();
        }

        [Fact]
        public void TheWebhookRoute_OutranksTheCatchAll()
        {
            var routes = Routes();
            var webhook = routes.Single(r => (string?)r["UpstreamPathTemplate"] == WebhookPath);
            var catchAll = routes.Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");

            ((int)webhook["Priority"]!).Should().BeGreaterThan((int)catchAll["Priority"]!);
        }

        private static JArray Routes()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "apps", "api-gateway", "Configuration", "Routes", "account-service-routes.json");
                if (File.Exists(candidate))
                {
                    return (JArray)JObject.Parse(File.ReadAllText(candidate))["Routes"]!;
                }

                directory = directory.Parent;
            }

            throw new DirectoryNotFoundException("Could not locate account-service-routes.json.");
        }
    }
}
