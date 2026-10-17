// <copyright file="SensitiveQueryRedactorTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Text.Json.Nodes;
using ApiGateway.Extensions;
using FluentAssertions;
using Xunit;

namespace ApiGateway.Tests.Extensions
{
    /// <summary>Guards that the unsubscribe token stays out of logs and trace attributes (#694).</summary>
    public class SensitiveQueryRedactorTests
    {
        private const string Token = "abc123.def456";

        [Theory]
        [InlineData("t=abc123.def456", "t=REDACTED")]
        [InlineData("?t=abc123.def456", "?t=REDACTED")]
        [InlineData("a=1&t=abc123.def456&b=2", "a=1&t=REDACTED&b=2")]
        [InlineData("http://h/notifications/unsubscribe?t=abc123.def456", "http://h/notifications/unsubscribe?t=REDACTED")]
        [InlineData("T=abc123.def456", "T=REDACTED")]
        [InlineData("fact=1", "fact=1")]
        public void Redact_ReplacesOnlyTheTokenValue(string input, string expected)
        {
            SensitiveQueryRedactor.Redact(input).Should().Be(expected);
        }

        [Fact]
        public void RedactTags_OverwritesEveryUrlTag_OnTheUnsubscribePath()
        {
            using var source = new ActivitySource("redactor-test");
            using var listener = new ActivityListener
            {
                ShouldListenTo = s => s.Name == "redactor-test",
                Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            };
            ActivitySource.AddActivityListener(listener);
            using var activity = source.StartActivity("request")!;
            activity.SetTag("url.query", $"t={Token}");
            activity.SetTag("url.full", $"http://h/notifications/unsubscribe?t={Token}");
            activity.SetTag("http.url", $"http://h/notifications/unsubscribe?t={Token}");
            activity.SetTag("http.target", $"/notifications/unsubscribe?t={Token}");

            SensitiveQueryRedactor.RedactTags(activity, "/notifications/unsubscribe");

            activity.TagObjects.Select(t => t.Value?.ToString()).Should().OnlyContain(v => v!.Contains("REDACTED", StringComparison.Ordinal) && !v.Contains(Token, StringComparison.Ordinal));
        }

        [Fact]
        public void RedactTags_LeavesOtherPathsAlone()
        {
            using var source = new ActivitySource("redactor-test-2");
            using var listener = new ActivityListener
            {
                ShouldListenTo = s => s.Name == "redactor-test-2",
                Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            };
            ActivitySource.AddActivityListener(listener);
            using var activity = source.StartActivity("request")!;
            activity.SetTag("url.query", "t=keep");

            SensitiveQueryRedactor.RedactTags(activity, "/account/profile");

            activity.GetTagItem("url.query").Should().Be("t=keep");
        }

        [Theory]
        [InlineData("appsettings.json")]
        [InlineData("appsettings.Development.json")]
        public void RequestAndClientLogging_IsAtWarning_SoNoUrlWithATokenIsLogged(string file)
        {
            var levels = JsonNode.Parse(File.ReadAllText(Path.Combine(GatewayRoot(), file)))!["Logging"]!["LogLevel"]!;

            ((string?)levels["Microsoft.AspNetCore"]).Should().Be("Warning");
            ((string?)levels["Ocelot"]).Should().Be("Warning");
            ((string?)levels["System.Net.Http.HttpClient"]).Should().Be("Warning");
        }

        [Fact]
        public void TheAccountService_LogsRequestsOnlyAtWarning()
        {
            var root = Path.GetDirectoryName(GatewayRoot())!;
            foreach (var file in new[] { "appsettings.json", "appsettings.Development.json" })
            {
                var levels = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "services", "account-service", file)))!["Logging"]!["LogLevel"]!;
                ((string?)levels["Microsoft.AspNetCore"]).Should().Be("Warning");
            }
        }

        private static string GatewayRoot()
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
