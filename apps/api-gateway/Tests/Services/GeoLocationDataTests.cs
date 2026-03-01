// <copyright file="GeoLocationDataTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using ApiGateway.Services;
using FluentAssertions;
using Xunit;

namespace ApiGateway.Tests.Services
{
    /// <summary>
    /// Unit tests for <see cref="GeoLocationData"/>.
    /// </summary>
    public class GeoLocationDataTests
    {
        [Fact]
        public void DefaultValues_ShouldAllBeNull()
        {
            // Arrange & Act
            var data = new GeoLocationData();

            // Assert
            data.CountryCode.Should().BeNull();
            data.CountryName.Should().BeNull();
            data.City.Should().BeNull();
            data.Region.Should().BeNull();
            data.RegionCode.Should().BeNull();
            data.Latitude.Should().BeNull();
            data.Longitude.Should().BeNull();
        }

        [Fact]
        public void Properties_ShouldRoundTrip()
        {
            // Arrange & Act
            var data = new GeoLocationData
            {
                CountryCode = "US",
                CountryName = "United States",
                City = "San Francisco",
                Region = "California",
                RegionCode = "CA",
                Latitude = 37.7749,
                Longitude = -122.4194,
            };

            // Assert
            data.CountryCode.Should().Be("US");
            data.CountryName.Should().Be("United States");
            data.City.Should().Be("San Francisco");
            data.Region.Should().Be("California");
            data.RegionCode.Should().Be("CA");
            data.Latitude.Should().Be(37.7749);
            data.Longitude.Should().Be(-122.4194);
        }
    }
}
