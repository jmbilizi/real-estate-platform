// <copyright file="NotificationPreferenceAudit.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One append-only record of a preference change: who, what, when and from where (#694).
/// It holds no email address. No FK, so the record outlives the account.
/// </summary>
internal sealed class NotificationPreferenceAudit
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the account whose preference changed.</summary>
    public string AccountId { get; set; } = string.Empty;

    /// <summary>Gets or sets the account that made the change. The unsubscribe link has no caller account.</summary>
    public string? ActorId { get; set; }

    /// <summary>Gets or sets the channel.</summary>
    public string Channel { get; set; } = string.Empty;

    /// <summary>Gets or sets the category.</summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the account was opted in before the change. Null when it had no row.</summary>
    public bool? PreviousEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the account is opted in after the change.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the source of the change.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets the id of the consent wording stored with an opt-in.</summary>
    public string? ConsentWordingId { get; set; }

    /// <summary>Gets or sets the version of that wording.</summary>
    public int? ConsentWordingVersion { get; set; }

    /// <summary>Gets or sets the UTC time of the change.</summary>
    public DateTime OccurredAt { get; set; }
}
