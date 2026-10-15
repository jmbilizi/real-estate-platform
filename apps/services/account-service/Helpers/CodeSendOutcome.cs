// <copyright file="CodeSendOutcome.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>What a code send did (#813). Every value except <see cref="Sent"/> means no code was queued.</summary>
internal enum CodeSendOutcome
{
    /// <summary>A code was queued for delivery.</summary>
    Sent,

    /// <summary>The per-email resend cooldown applies.</summary>
    Cooldown,

    /// <summary>The per-email hourly cap applies.</summary>
    HourlyCap,

    /// <summary>The per-email daily cap applies.</summary>
    DailyCap,

    /// <summary>The per-client-address send budget applies.</summary>
    NetworkCap,

    /// <summary>Too many wrong codes locked the address.</summary>
    Locked,

    /// <summary>A verified code for this address is still live. Nothing new was sent.</summary>
    Pending,

    /// <summary>An account owns the address. A notice was sent in place of a code.</summary>
    Notice,
}
