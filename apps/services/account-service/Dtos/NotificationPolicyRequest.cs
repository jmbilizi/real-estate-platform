// <copyright file="NotificationPolicyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /internal/account/notification-policy</c>.</summary>
internal sealed class NotificationPolicyRequest
{
    /// <summary>Gets or sets the questions. One to 100 items.</summary>
    public NotificationPolicyQuery[]? Items { get; set; }
}
