// <copyright file="AppSettings.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Strongly-typed options for the <c>Apps</c> configuration section.
/// Identifies the set of known application identifiers that can be stored in <c>UserApps</c>.
/// </summary>
internal sealed class AppSettings
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "Apps";

    /// <summary>
    /// Gets or sets the set of recognised app identifiers (e.g. "cribstop", "admin-portal").
    /// Only values present here are accepted as <c>AppId</c> on API keys or in the
    /// <c>X-App-Id</c> header. Unknown values are silently ignored.
    /// </summary>
    public IReadOnlyList<string> AllowedApps { get; set; } = Array.Empty<string>();
}
