// <copyright file="NotificationCategories.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// The notification categories. Only <see cref="NonTransactional"/> has a stored row. The policy lookup
/// also accepts <see cref="Marketing"/> and <see cref="Alert"/> and maps both to it.
/// Align with the event categories of <c>@events/contracts</c> (#791) when that library lands.
/// </summary>
internal static class NotificationCategories
{
    /// <summary>Mail the account did not ask for in the moment: the one stored category.</summary>
    public const string NonTransactional = "non_transactional";

    /// <summary>Marketing mail. Needs an opt-in.</summary>
    public const string Marketing = "marketing";

    /// <summary>Saved-search and price alerts. Need an opt-in.</summary>
    public const string Alert = "alert";

    /// <summary>Sign-in codes, security notices and request status. Cannot be switched off.</summary>
    public const string Transactional = "transactional";

    /// <summary>Gets a value indicating whether the category needs an opt-in.</summary>
    /// <param name="category">The category.</param>
    /// <returns><see langword="true"/> for marketing, alert and non-transactional.</returns>
    public static bool NeedsConsent(string category) =>
        category is NonTransactional or Marketing or Alert;

    /// <summary>Gets a value indicating whether the policy lookup accepts the category.</summary>
    /// <param name="category">The category.</param>
    /// <returns><see langword="true"/> for a known category.</returns>
    public static bool IsKnown(string category) =>
        NeedsConsent(category) || category == Transactional;
}
