// <copyright file="SignUpCompleteStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of the complete step.</summary>
internal enum SignUpCompleteStatus
{
    /// <summary>The account exists. The caller signs it in.</summary>
    Created,

    /// <summary>The proof is wrong, used, expired or for another address.</summary>
    InvalidProof,

    /// <summary>The password breaks the policy. The proof still works.</summary>
    PasswordRejected,

    /// <summary>The address has an account, or a deleted one. The answer is neutral.</summary>
    EmailUnavailable,
}
