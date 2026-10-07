// <copyright file="EmailChangeResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>The result of one email-change step.</summary>
/// <param name="Status">The outcome.</param>
/// <param name="RetryAfterSeconds">For <see cref="EmailChangeStatus.Limited"/>, the wait.</param>
/// <param name="ResendAfterSeconds">Seconds until a new code can be sent.</param>
/// <param name="ExpiresInSeconds">Seconds a code works.</param>
/// <param name="AttemptsLeft">For a wrong code, the tries left before the lock. Null when none counts.</param>
/// <param name="User">For <see cref="EmailChangeStatus.Changed"/>, the changed account, for the new session.</param>
internal sealed record EmailChangeResult(
    EmailChangeStatus Status,
    int RetryAfterSeconds = 0,
    int ResendAfterSeconds = 0,
    int ExpiresInSeconds = 0,
    int? AttemptsLeft = null,
    ApplicationUser? User = null);
