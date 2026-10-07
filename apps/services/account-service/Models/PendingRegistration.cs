// <copyright file="PendingRegistration.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// A sign-up that has not proved its mailbox. No account row exists for it. The row holds no
/// password and expires, so a typo or a fake address never reaches the accounts table.
/// </summary>
internal sealed class PendingRegistration
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the normalized (trimmed, upper-case) email address. Unique.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets the address as the user typed it, trimmed. The code goes here.</summary>
    public string EmailAsEntered { get; set; } = string.Empty;

    /// <summary>Gets or sets where the sign-up stands.</summary>
    public PendingRegistrationState State { get; set; }

    /// <summary>Gets or sets the UTC time the row was created.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC time of the last change.</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>Gets or sets the UTC time after which the purge deletes the row.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>Gets or sets the SHA-256 of the sign-up proof. Null until the code is verified.</summary>
    public byte[]? ProofHash { get; set; }

    /// <summary>Gets or sets the UTC time after which the proof does not work.</summary>
    public DateTime? ProofExpiresAt { get; set; }

    /// <summary>Gets or sets the UTC time the proof was used. Null while it is unused.</summary>
    public DateTime? ProofConsumedAt { get; set; }

    /// <summary>Gets or sets the concurrency token. Code raises it on every update.</summary>
    public int Version { get; set; }
}
