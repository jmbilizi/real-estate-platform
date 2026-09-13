// <copyright file="PasswordResetOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Strongly-typed options for the <c>PasswordReset</c> configuration section.
/// </summary>
/// <remarks>
/// Every security-relevant quantity of the reset flow is configuration rather than a constant, so
/// an environment can tighten or loosen it without a code change. The defaults here are the
/// production-appropriate values; <c>appsettings.json</c> states them explicitly so the effective
/// policy is legible without reading this file.
/// </remarks>
internal sealed class PasswordResetOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "PasswordReset";

    /// <summary>
    /// Gets or sets how long an issued reset token stays valid. Bound into the dedicated
    /// password-reset token provider, so this value is the one actually enforced when a token is
    /// redeemed — not merely advertised.
    /// </summary>
    public TimeSpan TokenLifetime { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// Gets or sets the number of reset requests allowed for one email address per
    /// <see cref="RequestWindow"/>.
    /// </summary>
    /// <remarks>
    /// This limit protects the mailbox and the outbound send cost, and it is the only one an
    /// attacker cannot sidestep by changing where they appear to come from. It cuts both ways:
    /// because the counter is keyed on the address that was asked about rather than on who asked,
    /// someone can spend the budget on a victim's address and deny them a reset link until the
    /// window rolls. The value is therefore a deliberate trade — high enough that a person who
    /// mistypes an address or loses an email is not locked out of recovery, low enough that the
    /// address is not a free mail cannon. Raise it before lowering it.
    /// </remarks>
    public int RequestsPerEmail { get; set; } = 5;

    /// <summary>Gets or sets the number of reset requests allowed from one client address per <see cref="RequestWindow"/>.</summary>
    public int RequestsPerAddress { get; set; } = 15;

    /// <summary>
    /// Gets or sets the number of redemption attempts allowed from one client address per
    /// <see cref="RequestWindow"/>. Bounds token guessing; set higher than
    /// <see cref="RequestsPerAddress"/> because a legitimate user may retry a password that fails
    /// the policy several times in a row.
    /// </summary>
    public int RedemptionsPerAddress { get; set; } = 30;

    /// <summary>Gets or sets the fixed window over which the request and redemption limits are counted.</summary>
    public TimeSpan RequestWindow { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Gets or sets the cap on how many rate-limit counters are held at once.
    /// </summary>
    /// <remarks>
    /// Half of each counter key is an attacker-chosen email address, so without a cap a flood of
    /// requests naming fresh addresses would grow the counter cache by one entry per request for a
    /// whole window. Exceeding the cap evicts counters, which loosens the limit; it does not
    /// exhaust memory.
    /// </remarks>
    public int MaxTrackedKeys { get; set; } = 50_000;

    /// <summary>
    /// Gets or sets the floor on how long a reset request or redemption takes to answer.
    /// </summary>
    /// <remarks>
    /// Issuing a token and handing it to a delivery channel costs real time; doing nothing because
    /// no account matched costs almost none. Left alone, that difference is a membership oracle
    /// that survives every effort to make the response bodies identical. Padding both outcomes up
    /// to a common floor removes the signal. Set to <see cref="TimeSpan.Zero"/> to disable.
    /// </remarks>
    public TimeSpan MinimumResponseDuration { get; set; } = TimeSpan.FromMilliseconds(250);
}
