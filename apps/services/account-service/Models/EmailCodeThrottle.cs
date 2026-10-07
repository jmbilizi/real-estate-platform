// <copyright file="EmailCodeThrottle.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// The wrong-try counter and lock for one email and purpose. It lives apart from
/// <see cref="EmailCode"/> so a new code does not reset it.
/// </summary>
internal sealed class EmailCodeThrottle
{
    /// <summary>Gets or sets the normalized (upper-case) email address.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets the purpose.</summary>
    public EmailCodePurpose Purpose { get; set; }

    /// <summary>Gets or sets the number of wrong tries since the last reset.</summary>
    public int FailedAttempts { get; set; }

    /// <summary>Gets or sets the UTC time of the last wrong try.</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>Gets or sets the UTC time the lock ends. Null when not locked.</summary>
    public DateTime? LockedUntil { get; set; }

    /// <summary>Gets or sets the concurrency token. Code raises it on every update.</summary>
    public int Version { get; set; }
}
