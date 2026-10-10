// <copyright file="NotificationPolicyItem.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>The answer for one policy question.</summary>
/// <param name="AccountId">The account id.</param>
/// <param name="Channel">The channel asked.</param>
/// <param name="Category">The category asked.</param>
/// <param name="Allowed">Whether the preference allows the send. A missing consent record is false for marketing and alert.</param>
/// <param name="Suppressed">Whether the suppression list blocks the address.</param>
/// <param name="EmailConfirmed">Whether the account's email is confirmed.</param>
/// <param name="UnsubscribeToken">The signed unsubscribe token. Only for non-transactional email.</param>
internal sealed record NotificationPolicyItem(
    Guid AccountId,
    string Channel,
    string Category,
    bool Allowed,
    bool Suppressed,
    bool EmailConfirmed,
    string? UnsubscribeToken);
