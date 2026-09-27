// <copyright file="GeoRegionResponse.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace ApiGateway.Services
{
    /// <summary>
    /// Response body for <c>GET /geo/region</c> (#362). City/region granularity only — no
    /// latitude, longitude, or postal code, matching the "no exact location" requirement.
    /// </summary>
    /// <param name="City">The resolved city name, or null.</param>
    /// <param name="Region">The resolved region/state name, or null.</param>
    /// <param name="RegionCode">The resolved region/state ISO code, or null.</param>
    /// <param name="CountryCode">The resolved country ISO code, or null.</param>
    internal sealed record GeoRegionResponse(string? City, string? Region, string? RegionCode, string? CountryCode);
}
