// <copyright file="PendingPropertyErasure.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// A deleted account whose property-service rows are not yet removed (#803). The delete writes the
/// row in the same save as the account change. The sweep calls property-service, then deletes the
/// row. No foreign key to AspNetUsers, so the row survives a later hard delete of the account.
/// </summary>
internal sealed class PendingPropertyErasure
{
    /// <summary>Gets or sets the id of the deleted account. It is the key, so a repeat enqueue is a no-op.</summary>
    public string AccountId { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time the account was deleted.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets how many calls failed so far.</summary>
    public int Attempts { get; set; }

    /// <summary>Gets or sets the UTC time before which the sweep does not retry the call.</summary>
    public DateTime NextAttemptAt { get; set; }
}
