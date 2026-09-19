// <copyright file="RouteQoSOptionsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Configuration
{
    /// <summary>
    /// Guards the Quality-of-Service configuration of the live route files (#52).
    /// </summary>
    /// <remarks>
    /// A route with no <c>QoSOptions</c> falls back to the global block, and a value below Polly's
    /// own minimum is discarded at runtime with no error. Both failures are silent, so they are
    /// asserted here rather than found in production.
    /// </remarks>
    public class RouteQoSOptionsTests
    {
        /// <summary>Polly rejects a circuit-breaker threshold below two.</summary>
        private const int LowMinimumThroughput = 2;

        /// <summary>Polly rejects a break shorter than 500 ms.</summary>
        private const int LowBreakDuration = 500;

        /// <summary>The longest timeout any route may declare. Beyond this a caller has given up.</summary>
        private const int MaxTimeout = 30000;

        private static readonly string GatewayRoot = FindGatewayRoot();

        /// <summary>
        /// Gets every route of every live route file, as (file name, route) pairs.
        /// </summary>
        public static TheoryData<string, string> LiveRoutes
        {
            get
            {
                var data = new TheoryData<string, string>();
                foreach (var file in Directory.GetFiles(RoutesFolder(), "*.json"))
                {
                    var doc = JObject.Parse(File.ReadAllText(file));
                    foreach (var route in (JArray)doc["Routes"]!)
                    {
                        data.Add(Path.GetFileName(file), (string)route["UpstreamPathTemplate"]!);
                    }
                }

                return data;
            }
        }

        [Fact]
        public void LiveRouteFiles_ShouldExist()
        {
            Directory.GetFiles(RoutesFolder(), "*.json").Should().NotBeEmpty();
        }

        [Theory]
        [MemberData(nameof(LiveRoutes))]
        public void EveryLiveRoute_ShouldDeclareUsableQoSOptions(string fileName, string upstreamPath)
        {
            // Arrange
            var route = FindRoute(fileName, upstreamPath);

            // Act
            var qos = route["QoSOptions"];

            // Assert
            qos.Should().NotBeNull($"{upstreamPath} in {fileName} must declare QoSOptions");

            var timeout = (int?)qos!["Timeout"];
            var minimumThroughput = (int?)qos["MinimumThroughput"];
            var breakDuration = (int?)qos["BreakDuration"];

            timeout.Should().NotBeNull().And.BeInRange(1, MaxTimeout);
            minimumThroughput.Should().NotBeNull().And.BeGreaterThanOrEqualTo(LowMinimumThroughput);
            breakDuration.Should().NotBeNull().And.BeGreaterThanOrEqualTo(LowBreakDuration);
        }

        [Theory]
        [MemberData(nameof(LiveRoutes))]
        public void EveryLiveRoute_ShouldUseTheSupportedPropertyNames(string fileName, string upstreamPath)
        {
            // Arrange
            var qos = FindRoute(fileName, upstreamPath)["QoSOptions"]!;

            // Assert — Ocelot 24.1 honours these three names but removes them in 25.0.
            qos["TimeoutValue"].Should().BeNull();
            qos["ExceptionsAllowedBeforeBreaking"].Should().BeNull();
            qos["DurationOfBreak"].Should().BeNull();
        }

        [Fact]
        public void GlobalConfiguration_ShouldDeclareAQoSFallback()
        {
            // Arrange — a route file added later with no QoSOptions still gets a timeout and a
            // breaker, because Ocelot merges the global block property by property.
            var settings = JObject.Parse(File.ReadAllText(Path.Combine(GatewayRoot, "Configuration", "Ocelot.Settings.json")));

            // Act
            var qos = settings["GlobalConfiguration"]!["QoSOptions"];

            // Assert
            qos.Should().NotBeNull();
            ((int?)qos!["Timeout"]).Should().NotBeNull().And.BeInRange(1, MaxTimeout);
            ((int?)qos["MinimumThroughput"]).Should().NotBeNull().And.BeGreaterThanOrEqualTo(LowMinimumThroughput);
            ((int?)qos["BreakDuration"]).Should().NotBeNull().And.BeGreaterThanOrEqualTo(LowBreakDuration);
            ((double?)qos["FailureRatio"]).Should().NotBeNull().And.BeInRange(0.01, 1.0);
            ((int?)qos["SamplingDuration"]).Should().NotBeNull().And.BeGreaterThanOrEqualTo(LowBreakDuration);
        }

        private static string RoutesFolder() => Path.Combine(GatewayRoot, "Configuration", "Routes");

        private static JToken FindRoute(string fileName, string upstreamPath)
        {
            var doc = JObject.Parse(File.ReadAllText(Path.Combine(RoutesFolder(), fileName)));
            return ((JArray)doc["Routes"]!)
                .First(route => (string?)route["UpstreamPathTemplate"] == upstreamPath);
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
