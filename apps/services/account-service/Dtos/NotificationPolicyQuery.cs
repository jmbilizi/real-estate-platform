// <copyright file="NotificationPolicyQuery.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>One question to the policy lookup.</summary>
internal sealed class NotificationPolicyQuery
{
    /// <summary>Gets or sets the account id.</summary>
    public Guid AccountId { get; set; }

    /// <summary>Gets or sets the channel: <c>email</c> or <c>sms</c>.</summary>
    public string? Channel { get; set; }

    /// <summary>Gets or sets the category: <c>transactional</c>, <c>marketing</c>, <c>alert</c> or <c>non_transactional</c>.</summary>
    public string? Category { get; set; }
}
