// <copyright file="EmailChangeRestore.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// What the "this wasn't me" restore window needs after an email change (#660). The change
/// ticket only writes the row. Ticket #662 reads it and owns the restore.
/// </summary>
internal sealed class EmailChangeRestore
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the id of the account whose email changed. No foreign key.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the address the account had before the change, as stored on the account.</summary>
    public string OldEmail { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time of the change.</summary>
    public DateTime ChangedAt { get; set; }

    /// <summary>Gets or sets the UTC time the restore window ends.</summary>
    public DateTime RestoreUntil { get; set; }

    /// <summary>Gets or sets the UTC time a restore used this row. Null while it is unused.</summary>
    public DateTime? ConsumedAt { get; set; }
}
