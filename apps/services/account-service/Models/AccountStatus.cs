// <copyright file="AccountStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Lookup table row representing a valid user account status (e.g. Active, Suspended, Banned).
/// </summary>
internal sealed class AccountStatus
{
    /// <summary>Gets or sets the primary key.</summary>
    public int Id { get; set; }

    /// <summary>Gets or sets the unique status code (e.g. "Active", "Suspended", "Banned").</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Gets or sets the human-readable display label.</summary>
    public string Label { get; set; } = string.Empty;
}
