// <copyright file="GeoIpServiceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using ApiGateway.Services;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace ApiGateway.Tests.Services
{
    /// <summary>
    /// Unit tests for <see cref="GeoIpService"/>.
    /// </summary>
    public class GeoIpServiceTests : IDisposable
    {
        private readonly Mock<ILogger<GeoIpService>> mockLogger;
        private GeoIpService? service;

        /// <summary>
        /// Initializes a new instance of the <see cref="GeoIpServiceTests"/> class.
        /// </summary>
        public GeoIpServiceTests()
        {
            mockLogger = new Mock<ILogger<GeoIpService>>();
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            service?.Dispose();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public void Constructor_WhenGeoIpDisabled_ShouldSetIsEnabledToFalse()
        {
            // Arrange
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "GEOIP_ENABLED", "false" },
                })
                .Build();

            // Act
            service = new GeoIpService(config, mockLogger.Object);

            // Assert
            service.IsEnabled.Should().BeFalse();
        }

        [Fact]
        public void Constructor_WhenGeoIpEnabledButNoDatabaseFile_ShouldSetIsEnabledToFalse()
        {
            // Arrange
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "GEOIP_ENABLED", "true" },
                })
                .Build();

            // Act
            service = new GeoIpService(config, mockLogger.Object);

            // Assert
            service.IsEnabled.Should().BeFalse();
        }

        [Fact]
        public void Constructor_WhenConfigurationIsNull_ShouldThrowArgumentNullException()
        {
            // Act
            var act = () => new GeoIpService(null!, mockLogger.Object);

            // Assert
            act.Should().Throw<ArgumentNullException>();
        }

        [Fact]
        public void GetLocation_WhenDisabled_ShouldReturnNull()
        {
            // Arrange
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "GEOIP_ENABLED", "false" },
                })
                .Build();
            service = new GeoIpService(config, mockLogger.Object);

            // Act
            var result = service.GetLocation("8.8.8.8");

            // Assert
            result.Should().BeNull();
        }

        [Fact]
        public void GetLocation_WhenDisabled_WithEmptyIp_ShouldReturnNull()
        {
            // Arrange
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    { "GEOIP_ENABLED", "false" },
                })
                .Build();
            service = new GeoIpService(config, mockLogger.Object);

            // Act
            var result = service.GetLocation(string.Empty);

            // Assert
            result.Should().BeNull();
        }
    }
}
