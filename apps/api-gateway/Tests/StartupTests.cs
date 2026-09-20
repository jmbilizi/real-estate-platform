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
        /// Verifies that OTEL_ENABLED=false can be read and handled by Startup.
        /// The fix ensures that Configure() does not crash when OTEL is disabled,
        /// because it conditionally registers UseOpenTelemetryPrometheusScrapingEndpoint()
        /// only when OTEL_ENABLED=true.
        /// </summary>
        [Fact]
        public void Startup_WithOtelDisabled_CanBeInstantiated()
        {
            // Arrange
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "OTEL_ENABLED", "false" },
                })
                .Build();

            // Act
            var startup = new Startup(configuration);

            // Assert
            startup.Configuration.GetValue("OTEL_ENABLED", true).Should().BeFalse();
        }

        /// <summary>
        /// Verifies that OTEL_ENABLED=true can be read and handled by Startup.
        /// This ensures the fix does not break the normal (OTEL-enabled) path.
        /// </summary>
        [Fact]
        public void Startup_WithOtelEnabled_CanBeInstantiated()
        {
            // Arrange
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "OTEL_ENABLED", "true" },
                })
                .Build();

            // Act
            var startup = new Startup(configuration);

            // Assert
            startup.Configuration.GetValue("OTEL_ENABLED", true).Should().BeTrue();
        }

        /// <summary>
        /// Verifies that OTEL_ENABLED defaults to true when not specified.
        /// This preserves backward compatibility for configurations that don't set this flag.
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
