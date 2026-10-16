// <copyright file="NotificationSources.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>The sources of a preference change.</summary>
internal static class NotificationSources
{
    /// <summary>The signed-in account changed it.</summary>
    public const string User = "user";

    /// <summary>The one-click unsubscribe link changed it.</summary>
    public const string UnsubscribeLink = "unsubscribe_link";

    /// <summary>The platform default. Never stored.</summary>
    public const string Default = "default";
}
