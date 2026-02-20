// <copyright file="GeoLocationData.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;

namespace ApiGateway.Services
{
    /// <summary>
    /// Represents geographic location data from a GeoIP lookup.
    /// </summary>
    [SuppressMessage("Performance", "CA1815:Override equals and operator equals on value types", Justification = "Simple data container, equality not needed")]
    internal struct GeoLocationData
    {
        /// <summary>
        /// Gets or sets the ISO country code (e.g., "US", "GB").
        /// </summary>
        public string? CountryCode { get; set; }

        /// <summary>
        /// Gets or sets the country name (e.g., "United States", "United Kingdom").
        /// </summary>
        public string? CountryName { get; set; }

        /// <summary>
        /// Gets or sets the city name (e.g., "San Francisco", "London").
        /// </summary>
        public string? City { get; set; }

        /// <summary>
        /// Gets or sets the region/state name (e.g., "California", "England").
        /// </summary>
        public string? Region { get; set; }

        /// <summary>
        /// Gets or sets the region/state code (e.g., "CA", "ENG").
        /// </summary>
        public string? RegionCode { get; set; }

        /// <summary>
        /// Gets or sets the postal/zip code.
        /// </summary>
        public string? PostalCode { get; set; }

        /// <summary>
        /// Gets or sets the latitude coordinate.
        /// </summary>
        public double? Latitude { get; set; }

        /// <summary>
        /// Gets or sets the longitude coordinate.
        /// </summary>
        public double? Longitude { get; set; }

        /// <summary>
        /// Gets or sets the timezone (e.g., "America/Los_Angeles").
        /// </summary>
        public string? TimeZone { get; set; }

        /// <summary>
        /// Gets or sets the continent name (e.g., "North America").
        /// </summary>
        public string? Continent { get; set; }

        /// <summary>
        /// Gets or sets the continent code (e.g., "NA").
        /// </summary>
        public string? ContinentCode { get; set; }
    }
}
