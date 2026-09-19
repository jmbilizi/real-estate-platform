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
                    // `as`, not a cast: a JSON file here with no Routes key is a missing-guard
                    // case for EveryLiveRouteFile_ShouldDeclareRoutes to name, not a crash during
                    // theory discovery.
                    var routes = JObject.Parse(File.ReadAllText(file))["Routes"] as JArray;
                    foreach (var route in routes ?? new JArray())
                    {
                        data.Add(Path.GetFileName(file), (string)route["UpstreamPathTemplate"]!);
                    }
                }

                return data;
            }
        }

        [Fact]
        public void EveryLiveRouteFile_ShouldDeclareRoutes()
        {
            // Without this the Theory below passes by enumerating nothing, which is the one way a
            // guard test lies.
            var files = Directory.GetFiles(RoutesFolder(), "*.json");
            files.Should().NotBeEmpty();

            foreach (var file in files)
            {
                var routes = JObject.Parse(File.ReadAllText(file))["Routes"] as JArray;
                routes.Should().NotBeNullOrEmpty($"{Path.GetFileName(file)} must declare routes");
            }
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
        public void EveryLiveRoute_ShouldHaveAWindowLongEnoughToOpenTheBreaker(string fileName, string upstreamPath)
        {
            // Arrange — Polly counts failures inside SamplingDuration and needs MinimumThroughput
            // of them. A failing call occupies its whole Timeout, so a window shorter than
            // MinimumThroughput x Timeout can never collect enough failures: the breaker stays
            // closed forever and every caller pays the full timeout. Every value below passes
            // Polly's own floors, so nothing reports this.
            var qos = Effective(fileName, upstreamPath);

            // Act
            var shortestRunToOpen = (long)qos.MinimumThroughput * qos.Timeout;

            // Assert — 1.5x, because the window slides and the first failure ages out of it.
            qos.SamplingDuration.Should().BeGreaterThanOrEqualTo(
                (int)(shortestRunToOpen * 3 / 2),
                $"{upstreamPath} needs a window that holds {qos.MinimumThroughput} failures of {qos.Timeout} ms");
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

            // The fallback a future route inherits must be able to open its own breaker.
            var shortestRunToOpen = (long)(int)qos["MinimumThroughput"]! * (int)qos["Timeout"]!;
            ((int)qos["SamplingDuration"]!).Should().BeGreaterThanOrEqualTo((int)(shortestRunToOpen * 3 / 2));
        }

        private static string RoutesFolder() => Path.Combine(GatewayRoot, "Configuration", "Routes");

        private static JToken GlobalQoS()
        {
            var settings = JObject.Parse(File.ReadAllText(Path.Combine(GatewayRoot, "Configuration", "Ocelot.Settings.json")));
            return settings["GlobalConfiguration"]!["QoSOptions"]!;
        }

        /// <summary>
        /// Resolves the values Ocelot really applies. It merges the global block into a route
        /// property by property, so a route that omits one still runs with the global value.
        /// </summary>
        /// <param name="fileName">The route file.</param>
        /// <param name="upstreamPath">The route's upstream template.</param>
        /// <returns>The merged timeout, breaker threshold and sampling window.</returns>
        private static (int Timeout, int MinimumThroughput, int SamplingDuration) Effective(string fileName, string upstreamPath)
        {
            var route = FindRoute(fileName, upstreamPath)["QoSOptions"];
            var global = GlobalQoS();
            int Merged(string name) => (int?)route?[name] ?? (int)global[name]!;
            return (Merged("Timeout"), Merged("MinimumThroughput"), Merged("SamplingDuration"));
        }

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
