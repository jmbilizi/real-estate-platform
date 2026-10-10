// <copyright file="AccountLookingForRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards that the "What I'm looking for" endpoints (#768) reach the account service through the
    /// <c>/account/{everything}</c> catch-all. The catch-all carries GET, PUT and DELETE, and no more
    /// specific route shadows <c>/account/looking-for</c>. The downstream OpenAPI document supplies the
    /// Swagger entry, so the existing <c>Account</c> Swagger endpoint covers these paths.
    /// </summary>
    public class AccountLookingForRoutesTests
    {
        [Fact]
        public void TheCatchAll_ForwardsGetPutAndDelete_ToTheSameDownstreamPath()
        {
            var catchAll = AccountRoutes()
                .Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");

            catchAll["UpstreamHttpMethod"]!.Select(m => (string?)m)
                .Should().Contain(["GET", "PUT", "DELETE"]);
            ((string?)catchAll["DownstreamPathTemplate"]).Should().Be("/account/{everything}");
        }

        [Fact]
        public void NoSpecificAccountRoute_ShadowsLookingFor()
        {
            // A literal route or a wildcard route (for example /account/{section}) would shadow the
            // catch-all for these paths. Each template becomes a regex: a placeholder matches one segment.
            var paths = new[] { "/account/looking-for", $"/account/looking-for/{Guid.NewGuid()}" };
            var shadows = AccountRoutes()
                .Select(r => (string?)r["UpstreamPathTemplate"] ?? string.Empty)
                .Where(t => t != "/account/{everything}")
                .Where(t => t.StartsWith("/account/", StringComparison.Ordinal))
                .Where(t =>
                {
                    var pattern = "^" + System.Text.RegularExpressions.Regex.Replace(
                        System.Text.RegularExpressions.Regex.Escape(t).Replace("\\{", "{", StringComparison.Ordinal),
                        @"\{[^}]+\}",
                        "[^/]+") + "/?$";
                    return paths.Any(p => System.Text.RegularExpressions.Regex.IsMatch(p, pattern));
                });

            shadows.Should().BeEmpty();
        }

        [Fact]
        public void TheAccountRoutes_AreActive_AndAdvertiseTheAccountSwaggerDocument()
        {
            var file = AccountRouteFile();

            ((bool?)file["Active"]).Should().BeTrue();
            ((string?)file["ServiceName"]).Should().Be("Account");
        }

        private static JArray AccountRoutes() => (JArray)AccountRouteFile()["Routes"]!;

        private static JObject AccountRouteFile()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "apps", "api-gateway", "Configuration", "Routes", "account-service-routes.json");
                if (File.Exists(candidate))
                {
                    return JObject.Parse(File.ReadAllText(candidate));
                }

                directory = directory.Parent;
            }

            throw new DirectoryNotFoundException("Could not locate account-service-routes.json.");
        }
    }
}
