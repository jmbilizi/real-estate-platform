// <copyright file="ApiKeyDefaults.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// Constants for the API key authentication scheme.
/// </summary>
internal static class ApiKeyDefaults
{
    /// <summary>The authentication scheme name used to identify API key auth.</summary>
    public const string AuthenticationScheme = "ApiKey";

    /// <summary>The HTTP header that carries the API key.</summary>
    public const string HeaderName = "X-Api-Key";
}
