// <copyright file="EmailChangeStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of one email-change step (#660).</summary>
internal enum EmailChangeStatus
{
    /// <summary>Start passed. The answer is the same for a taken and a free address.</summary>
    Accepted,

    /// <summary>Start sent a step-up code to the old address. The next call carries it.</summary>
    StepUpRequired,

    /// <summary>The new address is not well formed or holds a character the account name cannot hold.</summary>
    InvalidEmail,

    /// <summary>The password or the old-address code was wrong.</summary>
    StepUpFailed,

    /// <summary>The code from the new address was wrong. The result carries the tries left.</summary>
    WrongCode,

    /// <summary>A limit or a lock applies. The result carries the wait.</summary>
    Limited,

    /// <summary>The code engine has no key.</summary>
    Unavailable,

    /// <summary>The account is gone or soft-deleted.</summary>
    NoAccount,

    /// <summary>The swap is done. The result carries the account.</summary>
    Changed,

    /// <summary>The swap did not happen: the address was taken in the meantime, or another call won.</summary>
    Failed,
}
