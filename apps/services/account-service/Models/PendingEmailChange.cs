// <copyright file="PendingEmailChange.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// An email change that has passed step-up and waits for the code from the new mailbox (#660).
/// One row exists per account. A new start replaces it. The row exists for an address another
/// account uses too, so a taken address and a free one look the same to the caller.
/// </summary>
internal sealed class PendingEmailChange
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the id of the account that asked for the change. Unique. No foreign key.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the new address as typed, trimmed. The code goes here.</summary>
    public string NewEmail { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time the change started.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC time after which the change does not complete.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>Gets or sets the concurrency token. Code raises it on every update.</summary>
    public int Version { get; set; }
}
