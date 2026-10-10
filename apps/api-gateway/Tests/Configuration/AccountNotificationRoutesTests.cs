// <copyright file="AccountNotificationRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards the notification routes of #694. The preferences ride the <c>/account/{everything}</c>
    /// catch-all (GET and PUT). The one-click unsubscribe has its own POST-only, rate-limited route.
    /// The internal policy lookup has no route.
    /// </summary>
    public class AccountNotificationRoutesTests
    {
        private const string UnsubscribePath = "/notifications/unsubscribe";

        [Fact]
        public void TheCatchAll_ForwardsGetAndPut_ForNotificationPreferences()
        {
            var catchAll = Routes().Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");

            catchAll["UpstreamHttpMethod"]!.Select(m => (string?)m).Should().Contain(["GET", "PUT"]);
            Routes()
                .Select(r => (string?)r["UpstreamPathTemplate"] ?? string.Empty)
                .Where(t => t.StartsWith("/account/notification-preferences", StringComparison.Ordinal))
                .Should().BeEmpty();
        }

        [Fact]
        public void Unsubscribe_HasItsOwnPostOnlyRoute_WithARateLimit_AndOutranksTheCatchAll()
        {
            var routes = Routes();
            var route = routes.Single(r => (string?)r["UpstreamPathTemplate"] == UnsubscribePath);
            var catchAll = routes.Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");

            route["UpstreamHttpMethod"]!.Select(m => (string?)m).Should().Equal("POST");
            ((string?)route["DownstreamPathTemplate"]).Should().Be(UnsubscribePath);
            ((string?)route["DownstreamHostAndPorts"]![0]!["Host"]).Should().Be("account-service-svc");
            ((bool?)route["RateLimitOptions"]!["EnableRateLimiting"]).Should().BeTrue();
            ((int)route["Priority"]!).Should().BeGreaterThan((int)catchAll["Priority"]!);
        }

        [Fact]
        public void NoRoute_ReachesTheInternalPolicyLookup()
        {
            Routes()
                .Select(r => (string?)r["UpstreamPathTemplate"] ?? string.Empty)
                .Should().NotContain(t => t.Contains("notification-policy", StringComparison.OrdinalIgnoreCase));
        }

        [Theory]
        [InlineData("/internal/account/notification-policy")]
        [InlineData("/internal/account/introspect")]
        [InlineData("/account/../internal/account/notification-policy")]
        [InlineData("/ACCOUNT/internal/account/notification-policy")]
        public void TheCatchAll_NeverMapsARequestToAnInternalDownstreamPath(string upstream)
        {
            // Ocelot turns {everything} into a greedy match and substitutes it into the downstream template.
            // Every path it can produce starts with the fixed /account/ prefix, so /internal is out of reach.
            var catchAll = Routes().Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");
            var pattern = "^" + System.Text.RegularExpressions.Regex.Escape("/account/") + "(?<everything>.*)$";

            // Kestrel resolves dot segments before Ocelot sees the path. Do the same here.
            var normalized = new Uri("http://h" + upstream).AbsolutePath;
            var match = System.Text.RegularExpressions.Regex.Match(normalized, pattern);

            if (!match.Success)
            {
                return;
            }

            var downstream = ((string)catchAll["DownstreamPathTemplate"]!).Replace("{everything}", match.Groups["everything"].Value, StringComparison.Ordinal);
            downstream.Should().StartWith("/account/");
            Uri.TryCreate("http://h" + downstream, UriKind.Absolute, out var uri).Should().BeTrue();
            uri!.AbsolutePath.Should().StartWith("/account/", "dot segments must not climb out of /account");
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
