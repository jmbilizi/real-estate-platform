// <copyright file="PasswordResetProof.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// The one-time proof a right reset code earns. The row holds a hash of the proof, never the proof.
/// One row exists per address. A new proof replaces the old one.
/// </summary>
internal sealed class PasswordResetProof
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the normalized (trimmed, upper-case) email address. Unique.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets the id of the account the proof resets.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the SHA-256 of the proof.</summary>
    public byte[] ProofHash { get; set; } = Array.Empty<byte>();

    /// <summary>Gets or sets the UTC time the proof was issued.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC time after which the proof does not work.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>Gets or sets the UTC time the proof was used. Null while it is unused.</summary>
    public DateTime? ConsumedAt { get; set; }

    /// <summary>Gets or sets the concurrency token. Code raises it on every update.</summary>
    public int Version { get; set; }
}
