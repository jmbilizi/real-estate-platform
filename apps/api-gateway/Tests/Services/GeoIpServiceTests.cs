// <copyright file="GeoIpServiceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
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

        [Theory]
        [InlineData("127.0.0.1")] // IPv4 loopback
        [InlineData("::1")] // IPv6 loopback
        [InlineData("10.0.0.5")] // 10.0.0.0/8
        [InlineData("172.16.0.1")] // 172.16.0.0/12
        [InlineData("172.31.255.255")] // 172.16.0.0/12, upper bound
        [InlineData("192.168.1.1")] // 192.168.0.0/16
        [InlineData("fd00::1")] // fc00::/7, unique local
        [InlineData("::ffff:10.0.0.1")] // IPv4-mapped IPv6, wraps a 10.0.0.0/8 address
        public void IsPrivateOrLoopback_WithPrivateOrLoopbackIp_ReturnsTrue(string ip)
        {
            // #362: a private/loopback caller IP must never resolve to a location. GetLocation
            // only reaches this check with a real MaxMind database, which is not present in
            // this test environment (isEnabled is false without one), so this is asserted
            // directly against the classification logic instead.
            GeoIpService.IsPrivateOrLoopback(IPAddress.Parse(ip)).Should().BeTrue();
        }

        [Theory]
        [InlineData("8.8.8.8")] // Google public DNS
        [InlineData("172.15.255.255")] // just below the 172.16.0.0/12 private range
        [InlineData("172.32.0.0")] // just above the 172.16.0.0/12 private range
        [InlineData("2001:4860:4860::8888")] // Google public DNS, IPv6
        public void IsPrivateOrLoopback_WithPublicIp_ReturnsFalse(string ip)
        {
            GeoIpService.IsPrivateOrLoopback(IPAddress.Parse(ip)).Should().BeFalse();
        }
    }
}
