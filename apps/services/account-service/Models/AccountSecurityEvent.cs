// <copyright file="AccountSecurityEvent.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One append-only record of a security change on an account: whose account, what changed, when,
/// and from which client address. The record holds the address as a keyed hash, never in clear.
/// </summary>
internal sealed class AccountSecurityEvent
{
    /// <summary>The <see cref="Kind"/> value for a password reset by emailed code.</summary>
    public const string PasswordReset = "PasswordReset";

    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the id of the account the change applies to.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets what changed, for example <see cref="PasswordReset"/>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time of the change.</summary>
    public DateTime OccurredAt { get; set; }

    /// <summary>Gets or sets the keyed hash of the client address. Null when the address is unknown.</summary>
    public string? ClientAddressHash { get; set; }
}
