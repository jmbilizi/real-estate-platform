// <copyright file="ApiKey.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// An API key belonging to a user. The raw key is never stored — only its SHA-256 hash.
/// </summary>
internal sealed class ApiKey
{
    /// <summary>Gets or sets the primary key (GUID).</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the owning user's ID.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the human-readable label for this key (e.g. "CI/CD Pipeline").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the visible prefix of the key (e.g. "rep_abcd1234") for identification in listings.</summary>
    public string Prefix { get; set; } = string.Empty;

    /// <summary>Gets or sets the SHA-256 hash of the full key. Used for lookup during authentication.</summary>
    public string KeyHash { get; set; } = string.Empty;

    /// <summary>Gets or sets the app this key belongs to (e.g. "cribstop", "admin-portal"). Null means unrestricted to a specific app.</summary>
    public string? AppId { get; set; }

    /// <summary>Gets or sets a space-separated list of permission scopes for this key (e.g. "listings:read listings:write"). Null means full access.</summary>
    public string? Scopes { get; set; }

    /// <summary>Gets or sets the optional UTC expiration timestamp. Null means the key never expires.</summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Gets or sets the UTC timestamp of the most recent use. Updated by the auth handler.</summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>Gets or sets the UTC timestamp when this key was revoked. Null means the key is active.</summary>
    public DateTime? RevokedAt { get; set; }

    /// <summary>Gets or sets the UTC timestamp when this key was created.</summary>
    public DateTime CreatedAt { get; set; }

    // Navigation properties

    /// <summary>Gets or sets the owning user.</summary>
    public ApplicationUser? User { get; set; }
}
