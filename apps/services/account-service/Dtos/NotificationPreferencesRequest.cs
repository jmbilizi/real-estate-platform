// <copyright file="NotificationPreferencesRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>PUT /account/notification-preferences</c>.</summary>
internal sealed class NotificationPreferencesRequest
{
    /// <summary>Gets or sets the preferences to change. One to four items.</summary>
    public NotificationPreferenceItem[]? Items { get; set; }
}
