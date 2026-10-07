// <copyright file="PasswordResetCompleteStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of the reset complete step.</summary>
internal enum PasswordResetCompleteStatus
{
    /// <summary>The password changed and every session ended.</summary>
    Done,

    /// <summary>The proof is missing, wrong, used, expired or for another address.</summary>
    InvalidProof,

    /// <summary>The password policy or the breach check refused the password. The proof stays live.</summary>
    PasswordRejected,
}
