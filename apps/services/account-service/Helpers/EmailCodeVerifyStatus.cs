// <copyright file="EmailCodeVerifyStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of <see cref="EmailCodeService.VerifyAsync"/>.</summary>
internal enum EmailCodeVerifyStatus
{
    /// <summary>The code was right. It is now used up.</summary>
    Verified,

    /// <summary>
    /// The code was wrong, expired, used, voided or never issued. One status for all of them,
    /// so the caller cannot tell which.
    /// </summary>
    Invalid,

    /// <summary>The email and purpose are locked after wrong tries.</summary>
    Locked,

    /// <summary>The engine has no key. It refuses every call.</summary>
    Unavailable,
}
