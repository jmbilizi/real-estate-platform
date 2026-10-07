// <copyright file="EmailCodeIssueStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of <see cref="EmailCodeService.IssueAsync"/>.</summary>
internal enum EmailCodeIssueStatus
{
    /// <summary>A code was stored and queued for delivery.</summary>
    Issued,

    /// <summary>A resend limit applies. See <see cref="EmailCodeIssueResult.RetryAfterSeconds"/>.</summary>
    Throttled,

    /// <summary>The email and purpose are locked after wrong tries.</summary>
    Locked,

    /// <summary>The engine has no key. It refuses every call.</summary>
    Unavailable,
}
