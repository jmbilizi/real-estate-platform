// <copyright file="AccountSignUpRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards that the sign-up (#652) and identify (#653) endpoints reach the account service through the
    /// <c>/account/{everything}</c> catch-all, with no more specific route in the way.
    /// </summary>
    public class AccountSignUpRoutesTests
    {
        private static readonly string[] SignUpPaths =
        [
            "/account/signup/start",
            "/account/signup/verify",
            "/account/signup/resend",
            "/account/signup/change-email",
            "/account/identify",
        ];

        [Fact]
        public void TheCatchAll_ForwardsPost_ToTheSameDownstreamPath()
        {
            var routes = AccountRoutes();

            var catchAll = routes.Single(r => (string?)r["UpstreamPathTemplate"] == "/account/{everything}");

            catchAll["UpstreamHttpMethod"]!.Select(m => (string?)m).Should().Contain("POST");
            ((string?)catchAll["DownstreamPathTemplate"]).Should().Be("/account/{everything}");
        }

        [Fact]
        public void NoSpecificAccountRoute_ShadowsASignUpPath()
        {
            var specific = AccountRoutes()
                .Select(r => (string?)r["UpstreamPathTemplate"] ?? string.Empty)
                .Where(t => !t.Contains('{', StringComparison.Ordinal));

            specific.Should().NotIntersectWith(SignUpPaths);
        }

        [Fact]
        public void NoRouteNamesARetiredLinkEndpoint()
        {
            // The link flows are retired. The catch-all still forwards them, and the account service answers 404.
            var upstream = AccountRoutes().Select(r => (string?)r["UpstreamPathTemplate"] ?? string.Empty);

            upstream.Should().NotContain("/account/register")
                .And.NotContain("/account/confirmEmail")
                .And.NotContain("/account/resendConfirmationEmail")
                .And.NotContain("/account/forgotPassword")
                .And.NotContain("/account/resetPassword");
        }

        private static JArray AccountRoutes()
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
