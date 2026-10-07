// <copyright file="SignUpStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of a sign-up step.</summary>
internal enum SignUpStatus
{
    /// <summary>The step was accepted. Start, resend and change-email return this.</summary>
    Ok,

    /// <summary>The code was right. The result carries the proof.</summary>
    Verified,

    /// <summary>The address is not well formed.</summary>
    InvalidEmail,

    /// <summary>The code was wrong. The result carries the tries left.</summary>
    WrongCode,

    /// <summary>A limit or a lock applies. The result carries the wait.</summary>
    Limited,

    /// <summary>The code engine has no key.</summary>
    Unavailable,

    /// <summary>The address is suppressed at Postmark, or its domain cannot receive mail (#664).</summary>
    Undeliverable,
}
