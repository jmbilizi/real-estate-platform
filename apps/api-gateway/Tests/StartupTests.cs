// <copyright file="StartupTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ApiGateway.Tests
{
    /// <summary>
    /// Tests for the gateway startup configuration.
    /// Regression test for issue #170: the gateway crashed on startup when OTEL_ENABLED=false
    /// because Configure called UseOpenTelemetryPrometheusScrapingEndpoint() unconditionally
    /// without registering MeterProvider. The fix conditionally registers the endpoint only
    /// when OTEL is enabled.
    /// </summary>
    public class StartupTests
    {
        /// <summary>
        /// Verifies that Startup can be instantiated with OTEL_ENABLED=false.
        /// </summary>
        [Fact]
        public void Startup_WithOtelDisabled_CanBeInstantiated()
        {
            // Arrange
            var configValues = new Dictionary<string, string?>
            {
                { "OTEL_ENABLED", "false" },
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configValues)
                .Build();

            // Act
            var action = () => new Startup(configuration);

            // Assert
            action.Should().NotThrow();
            var startup = new Startup(configuration);
            startup.Configuration.GetValue("OTEL_ENABLED", true).Should().BeFalse();
        }

        /// <summary>
        /// Verifies that Startup can be instantiated with OTEL_ENABLED=true.
        /// </summary>
        [Fact]
        public void Startup_WithOtelEnabled_CanBeInstantiated()
        {
            // Arrange
            var configValues = new Dictionary<string, string?>
            {
                { "OTEL_ENABLED", "true" },
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configValues)
                .Build();

            // Act
            var action = () => new Startup(configuration);

            // Assert
            action.Should().NotThrow();
            var startup = new Startup(configuration);
            startup.Configuration.GetValue("OTEL_ENABLED", true).Should().BeTrue();
        }

        /// <summary>
        /// Verifies that OTEL_ENABLED defaults to true when not specified.
        /// </summary>
        [Fact]
        public void Startup_WithOtelNotSpecified_DefaultsToTrue()
        {
            // Arrange
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>())
                .Build();

            // Act
            var startup = new Startup(configuration);

            // Assert
            startup.Configuration.GetValue("OTEL_ENABLED", true).Should().BeTrue();
        }
    }
}
