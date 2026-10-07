// <copyright file="PasswordChangeStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of an in-account password change.</summary>
internal enum PasswordChangeStatus
{
    /// <summary>The password changed.</summary>
    Changed,

    /// <summary>The request has no current password.</summary>
    CurrentRequired,

    /// <summary>The current password is wrong, or the account has none.</summary>
    CurrentWrong,

    /// <summary>The new password breaks the policy. The result lists the error codes.</summary>
    PasswordRejected,

    /// <summary>The account is locked after too many wrong passwords.</summary>
    Limited,

    /// <summary>The account does not exist or is deleted.</summary>
    NoAccount,
}
