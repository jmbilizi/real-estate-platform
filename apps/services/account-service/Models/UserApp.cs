// <copyright file="UserApp.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Records which apps a user has authenticated with, and when they were first and last seen.
/// One row per (UserId, AppId) pair — upserted automatically by the auth pipeline.
/// </summary>
internal sealed class UserApp
{
    /// <summary>Gets or sets the owning user's ID.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the app identifier (e.g. "cribstop", "admin-portal").</summary>
    public string AppId { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC timestamp of the user's first interaction with this app.</summary>
    public DateTime FirstSeenAt { get; set; }

    /// <summary>Gets or sets the UTC timestamp of the user's most recent interaction with this app.</summary>
    public DateTime LastSeenAt { get; set; }

    // Navigation properties

    /// <summary>Gets or sets the owning user.</summary>
    public ApplicationUser? User { get; set; }
}
