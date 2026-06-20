// <copyright file="Locale.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// A supported locale used as a lookup table for user language and regional preferences.
/// </summary>
internal sealed class Locale
{
    /// <summary>Gets or sets the primary key.</summary>
    public int Id { get; set; }

    /// <summary>Gets or sets the IETF BCP 47 locale code (e.g. "en-US", "fr-FR").</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Gets or sets the human-readable locale name (e.g. "English (United States)").</summary>
    public string Name { get; set; } = string.Empty;
}
