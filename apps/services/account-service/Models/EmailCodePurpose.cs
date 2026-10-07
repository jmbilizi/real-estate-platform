// <copyright file="EmailCodePurpose.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>What an emailed code proves. A code issued for one purpose never verifies for another.</summary>
internal enum EmailCodePurpose
{
    /// <summary>The owner of a new address confirms it at sign-up.</summary>
    SignUp,

    /// <summary>The owner of an account confirms a password reset.</summary>
    PasswordReset,

    /// <summary>The owner of the new address confirms an email change.</summary>
    EmailChangeNew,

    /// <summary>The owner of the old address confirms an email change.</summary>
    EmailChangeOld,
}
