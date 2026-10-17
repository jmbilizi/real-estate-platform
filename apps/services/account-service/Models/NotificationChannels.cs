// <copyright file="NotificationChannels.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>The notification channels.</summary>
internal static class NotificationChannels
{
    /// <summary>Email.</summary>
    public const string Email = "email";

    /// <summary>SMS. Cannot be enabled until TCPA consent exists.</summary>
    public const string Sms = "sms";

    /// <summary>Gets every channel.</summary>
    public static readonly IReadOnlyList<string> All = new string[] { Email, Sms };
}
