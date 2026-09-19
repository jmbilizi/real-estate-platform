// <copyright file="RateLimitOptionsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using ApiGateway.Middleware;
using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards the global rate-limit configuration (#177).
    /// </summary>
    /// <remarks>
    /// Ocelot writes <c>QuotaExceededMessage</c> as the literal 429 response body. A plain
    /// sentence there is unparsable JSON, so a client that expects the gateway's error envelope
    /// gets neither the code nor the message — only the status survives. This asserts the config
    /// value is kept in sync with <see cref="RateLimitContract"/>, which documents the intended
    /// shape.
    /// </remarks>
    public class RateLimitOptionsTests
    {
        [Fact]
        public void QuotaExceededMessage_ShouldBeTheDocumentedEnvelope()
        {
            // Arrange
            var settings = LoadSettings();
            var rateLimit = settings["GlobalConfiguration"]!["RateLimitOptions"]!;

            // Act
            var quotaExceededMessage = (string?)rateLimit["QuotaExceededMessage"];

            // Assert — the config string must be valid JSON matching the documented contract,
            // not just human-readable text.
            quotaExceededMessage.Should().Be(RateLimitContract.ResponseBody);

            var body = JObject.Parse(quotaExceededMessage!);
            ((string?)body["error"]!["code"]).Should().Be(RateLimitContract.ErrorCode);
            ((string?)body["error"]!["message"]).Should().NotBeNullOrWhiteSpace();
        }

        [Fact]
        public void HttpStatusCode_ShouldBe429()
        {
            // Arrange
            var settings = LoadSettings();
            var rateLimit = settings["GlobalConfiguration"]!["RateLimitOptions"]!;

            // Act
            var statusCode = (int?)rateLimit["HttpStatusCode"];

            // Assert
            statusCode.Should().Be(RateLimitContract.StatusCode);
        }

        private static JObject LoadSettings()
        {
            var gatewayRoot = FindGatewayRoot();
            return JObject.Parse(File.ReadAllText(Path.Combine(gatewayRoot, "Configuration", "Ocelot.Settings.json")));
        }

        /// <summary>
        /// Locates the gateway project from the workspace root. The test assembly builds into
        /// <c>dist/</c>, so walking up from it never passes through <c>apps/api-gateway</c>.
        /// </summary>
        /// <returns>The absolute path of the gateway project directory.</returns>
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
