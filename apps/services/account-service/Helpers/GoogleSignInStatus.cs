// <copyright file="GoogleSignInStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of a Google sign-in.</summary>
internal enum GoogleSignInStatus
{
    /// <summary>The caller is signed in. <c>User</c> is set.</summary>
    SignedIn,

    /// <summary>No client ID is configured.</summary>
    NotConfigured,

    /// <summary>The token failed validation.</summary>
    InvalidToken,

    /// <summary>Google did not verify the address.</summary>
    EmailNotVerified,

    /// <summary>The account is soft-deleted or locked out.</summary>
    Refused,
}
