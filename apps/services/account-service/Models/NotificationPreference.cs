// <copyright file="NotificationPreference.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One stored consent decision of an account for one channel and category (#694). A missing row
/// means "not opted in". The row is the consent record: the wording shown, the time and the source.
/// The key (AccountId, Channel, Category) gives one set per account, whatever its roles.
/// </summary>
internal sealed class NotificationPreference
{
    /// <summary>Gets or sets the owning account's id. No FK, so the record outlives the account.</summary>
    public string AccountId { get; set; } = string.Empty;

    /// <summary>Gets or sets the channel (see <see cref="NotificationChannels"/>).</summary>
    public string Channel { get; set; } = string.Empty;

    /// <summary>Gets or sets the category (see <see cref="NotificationCategories"/>).</summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the account opted in.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the UTC time of the last change.</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>Gets or sets who made the last change (see <see cref="NotificationSources"/>).</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets the id of the server-held wording the account saw when it opted in. Kept after an opt-out.</summary>
    public string? ConsentWordingId { get; set; }

    /// <summary>Gets or sets the version of that wording.</summary>
    public int? ConsentWordingVersion { get; set; }

    /// <summary>Gets or sets the UTC time of the last opt-in.</summary>
    public DateTime? ConsentedAt { get; set; }
}
