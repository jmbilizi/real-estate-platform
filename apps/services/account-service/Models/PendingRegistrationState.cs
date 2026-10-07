// <copyright file="PendingRegistrationState.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>Where a pending sign-up stands.</summary>
internal enum PendingRegistrationState
{
    /// <summary>A code is out. The user has not proved the mailbox yet.</summary>
    AwaitingCode,

    /// <summary>The user proved the mailbox. A one-time sign-up proof is out.</summary>
    Verified,
}
