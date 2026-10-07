// <copyright file="ContactLookupItem.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Contact facts for one known account.</summary>
/// <param name="AccountId">The account id.</param>
/// <param name="DisplayName">The display name, or null.</param>
/// <param name="Email">The email address.</param>
/// <param name="EmailConfirmed">Whether the email is confirmed.</param>
internal sealed record ContactLookupItem(Guid AccountId, string? DisplayName, string? Email, bool EmailConfirmed);
