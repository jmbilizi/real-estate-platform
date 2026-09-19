// <copyright file="WaitlistInterest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Records that an account registered early-access interest in one pillar. One row per
/// (UserId, InterestKind) pair, so registering twice stays one registration.
/// <para>
/// The row carries no signal beyond the pillar and the date. <see cref="RegisteredAt"/> exists to
/// give the waitlist a cohort date, which the waitlist-to-active conversion metric needs
/// (PRD §16).
/// </para>
/// </summary>
internal sealed class WaitlistInterest
{
    /// <summary>Gets or sets the owning account's ID.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the interest kind (see <see cref="WaitlistInterestKinds"/>).</summary>
    public string InterestKind { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC timestamp of the registration.</summary>
    public DateTime RegisteredAt { get; set; }

    // Navigation properties

    /// <summary>Gets or sets the owning account.</summary>
    public ApplicationUser? User { get; set; }
}
