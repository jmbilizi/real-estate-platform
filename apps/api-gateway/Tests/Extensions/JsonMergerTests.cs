// <copyright file="JsonMergerTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using ApiGateway.Extensions;
using FluentAssertions;
using Newtonsoft.Json.Linq;
using Xunit;

namespace ApiGateway.Tests.Extensions
{
    /// <summary>
    /// Unit tests for <see cref="JsonMerger"/>.
    /// </summary>
    public class JsonMergerTests : IDisposable
    {
        private readonly string testDir;
        private readonly string routesDir;
        private readonly string baseConfigPath;

        /// <summary>
        /// Initializes a new instance of the <see cref="JsonMergerTests"/> class.
        /// </summary>
        public JsonMergerTests()
        {
            testDir = Path.Combine(Path.GetTempPath(), $"JsonMergerTests_{Guid.NewGuid():N}");
            routesDir = Path.Combine(testDir, "Routes");
            baseConfigPath = Path.Combine(testDir, "Ocelot.Settings.json");

            Directory.CreateDirectory(testDir);
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            if (Directory.Exists(testDir))
            {
                Directory.Delete(testDir, recursive: true);
            }

            GC.SuppressFinalize(this);
        }

        [Fact]
        public void Merge_WithNoRoutesFolder_ShouldReturnBaseConfig()
        {
            // Arrange
            WriteBaseConfig();

            // Act (routes folder doesn't exist)
            var result = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(routesDir, baseConfigPath);

            // Assert
            var json = JObject.Parse(result);
            json["Routes"].Should().NotBeNull();
            ((JArray)json["Routes"]!).Should().BeEmpty();
            json["GlobalConfiguration"]!["BaseUrl"]!.ToString().Should().Be("https://localhost");
        }

        [Fact]
        public void Merge_WithEmptyRoutesFolder_ShouldReturnBaseConfig()
        {
            // Arrange
            WriteBaseConfig();
            Directory.CreateDirectory(routesDir);

            // Act
            var result = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(routesDir, baseConfigPath);

            // Assert
            var json = JObject.Parse(result);
            ((JArray)json["Routes"]!).Should().BeEmpty();
        }

        [Fact]
        public void Merge_WithActiveService_ShouldMergeRoutes()
        {
            // Arrange
            WriteBaseConfig();
            Directory.CreateDirectory(routesDir);

            var serviceConfig = new JObject
            {
                ["Active"] = true,
                ["ServiceName"] = "accounts",
                ["Routes"] = new JArray
                {
                    new JObject
                    {
                        ["UpstreamPathTemplate"] = "/api/accounts/{everything}",
                        ["DownstreamPathTemplate"] = "/api/{everything}",
                        ["DownstreamScheme"] = "http",
                    },
                },
                ["SwaggerEndPoints"] = new JArray
                {
                    new JObject
                    {
                        ["Key"] = "accounts",
                        ["Config"] = new JArray
                        {
                            new JObject
                            {
                                ["Name"] = "Accounts API",
                                ["Version"] = "v1",
                                ["Url"] = "http://accounts-svc:8080/swagger/v1/swagger.json",
                            },
                        },
                    },
                },
            };

            File.WriteAllText(Path.Combine(routesDir, "accounts.json"), serviceConfig.ToString());

            // Act
            var result = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(routesDir, baseConfigPath);

            // Assert
            var json = JObject.Parse(result);
            var routes = (JArray)json["Routes"]!;
            routes.Should().HaveCount(1);
            routes[0]!["UpstreamPathTemplate"]!.ToString().Should().Be("/api/accounts/{everything}");
            routes[0]!["SwaggerKey"]!.ToString().Should().Be("accounts");

            var swaggerEndpoints = (JArray)json["SwaggerEndPoints"]!;
            swaggerEndpoints.Should().HaveCount(1);
        }

        [Fact]
        public void Merge_WithInactiveService_ShouldNotMergeRoutes()
        {
            // Arrange
            WriteBaseConfig();
            Directory.CreateDirectory(routesDir);

            var serviceConfig = new JObject
            {
                ["Active"] = false,
                ["ServiceName"] = "disabled-service",
                ["Routes"] = new JArray
                {
                    new JObject
                    {
                        ["UpstreamPathTemplate"] = "/api/disabled/{everything}",
                        ["DownstreamPathTemplate"] = "/api/{everything}",
                    },
                },
            };

            File.WriteAllText(Path.Combine(routesDir, "disabled.json"), serviceConfig.ToString());

            // Act
            var result = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(routesDir, baseConfigPath);

            // Assert
            var json = JObject.Parse(result);
            ((JArray)json["Routes"]!).Should().BeEmpty();
        }

        [Fact]
        public void Merge_WithMultipleServices_ShouldMergeOnlyActive()
        {
            // Arrange
            WriteBaseConfig();
            Directory.CreateDirectory(routesDir);

            var activeService = new JObject
            {
                ["Active"] = true,
                ["ServiceName"] = "listings",
                ["Routes"] = new JArray
                {
                    new JObject
                    {
                        ["UpstreamPathTemplate"] = "/api/listings/{everything}",
                        ["DownstreamPathTemplate"] = "/api/{everything}",
                    },
                },
                ["SwaggerEndPoints"] = new JArray(),
            };

            var inactiveService = new JObject
            {
                ["Active"] = false,
                ["ServiceName"] = "messaging",
                ["Routes"] = new JArray
                {
                    new JObject
                    {
                        ["UpstreamPathTemplate"] = "/api/messaging/{everything}",
                    },
                },
            };

            File.WriteAllText(Path.Combine(routesDir, "listings.json"), activeService.ToString());
            File.WriteAllText(Path.Combine(routesDir, "messaging.json"), inactiveService.ToString());

            // Act
            var result = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(routesDir, baseConfigPath);

            // Assert
            var json = JObject.Parse(result);
            var routes = (JArray)json["Routes"]!;
            routes.Should().HaveCount(1);
            routes[0]!["UpstreamPathTemplate"]!.ToString().Should().Be("/api/listings/{everything}");
        }

        private void WriteBaseConfig()
        {
            var baseConfig = new JObject
            {
                ["GlobalConfiguration"] = new JObject
                {
                    ["BaseUrl"] = "https://localhost",
                },
                ["Routes"] = new JArray(),
                ["SwaggerEndPoints"] = new JArray(),
            };

            File.WriteAllText(baseConfigPath, baseConfig.ToString());
        }
    }
}
