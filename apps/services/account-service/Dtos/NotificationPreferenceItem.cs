// <copyright file="NotificationPreferenceItem.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>One preference in a <c>PUT /account/notification-preferences</c> body.</summary>
internal sealed class NotificationPreferenceItem
{
    /// <summary>Gets or sets the channel: <c>email</c> or <c>sms</c>.</summary>
    public string? Channel { get; set; }

    /// <summary>Gets or sets the category. Only <c>non_transactional</c> is stored.</summary>
    public string? Category { get; set; }

    /// <summary>Gets or sets a value indicating whether the account opts in.</summary>
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets the wording the account saw. Required to opt in.</summary>
    public string? ConsentText { get; set; }
}
