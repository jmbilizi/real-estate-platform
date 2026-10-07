// <copyright file="AccountRecoveryOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Strongly-typed options for the <c>AccountRecovery</c> configuration section: the policy over the
/// service's whole unauthenticated account-recovery surface — sign-up codes, identify and
/// password reset.
/// </summary>
/// <remarks>
/// <para>
/// One options type rather than several because it is genuinely one policy. The endpoints it governs
/// are ASP.NET Core Identity's own (<c>MapIdentityApi</c>), which ship with no rate limiting of any
/// kind and no timing equalisation, so everything here is a guarantee this service adds on top of
/// them and shares a single window and a single response floor.
/// </para>
/// <para>
/// Every security-relevant quantity is configuration rather than a constant, so an environment can
/// tighten or loosen it without a code change. The defaults here are the production-appropriate
/// values; <c>appsettings.json</c> states them explicitly so the effective policy is legible without
/// reading this file.
/// </para>
/// </remarks>
internal sealed class AccountRecoveryOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "AccountRecovery";

    /// <summary>
    /// Gets or sets the public origin of the web app, for example <c>https://cribstop.com</c>.
    /// The password-reset link is built from it. Required. No default in code (PRD §1).
    /// </summary>
    public Uri? WebBaseUrl { get; set; }

    /// <summary>
    /// Gets or sets the web route that receives the password-reset link, carrying <c>email</c> and
    /// <c>code</c>. The settled value is <c>/reset-password</c> (#137). Required.
    /// </summary>
    public string PasswordResetPath { get; set; } = string.Empty;

    /// <summary>Gets or sets the web path of the "This wasn't me" page that #662 builds.</summary>
    public string SecureAccountPath { get; set; } = "/secure-account";

    /// <summary>
    /// Gets or sets how long an issued password-reset token stays valid. Enforced by the dedicated
    /// <c>PasswordResetTokenProvider</c>, so the configured value is the one actually enforced when
    /// a token is redeemed.
    /// </summary>
    public TimeSpan TokenLifetime { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// Gets or sets the number of password-reset requests allowed for one email address per
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

    /// <summary>
    /// Gets or sets the password-reset requests allowed from one client address per
    /// <see cref="RequestWindow"/>.
    /// </summary>
    public int RequestsPerAddress { get; set; } = 15;

    /// <summary>
    /// Gets or sets the number of reset redemption attempts allowed from one client address per
    /// <see cref="RequestWindow"/>. Bounds token guessing; set higher than
    /// <see cref="RequestsPerAddress"/> because a legitimate user may retry a password that fails
    /// the policy several times in a row.
    /// </summary>
    public int RedemptionsPerAddress { get; set; } = 30;

    /// <summary>
    /// Gets or sets the sign-up sends (start, resend, change-email) allowed from one client address
    /// per <see cref="RequestWindow"/>. Loose: one client address is often many people behind one NAT.
    /// </summary>
    public int SignUpSendsPerAddress { get; set; } = 20;

    /// <summary>
    /// Gets or sets the sign-up code checks allowed from one client address per
    /// <see cref="RequestWindow"/>. A lock needs five wrong tries on one email, so this also caps
    /// how many emails one address can lock for 15 minutes.
    /// </summary>
    public int SignUpVerifiesPerAddress { get; set; } = 20;

    /// <summary>
    /// Gets or sets the identify calls (#653) allowed from one client address per
    /// <see cref="RequestWindow"/>. Valid and invalid addresses both count.
    /// </summary>
    public int IdentifiesPerAddress { get; set; } = 20;

    /// <summary>
    /// Gets or sets the identify calls (#653) allowed for one email per <see cref="RequestWindow"/>.
    /// </summary>
    public int IdentifiesPerEmail { get; set; } = 5;

    /// <summary>Gets or sets the window for the per-client-address counters.</summary>
    public TimeSpan RequestWindow { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Gets or sets the cap on live rate-limit counters. At the cap the limiter refuses requests
    /// rather than stop counting. Size it well above the distinct addresses expected in one window.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Half of each counter key is an attacker-chosen email address, so without a cap a flood of
    /// requests naming fresh addresses would grow the counter cache by one entry per request for a
    /// whole window.
    /// </para>
    /// <para>
    /// At the cap the limiter <b>fails closed</b>: a request whose counter cannot be stored is
    /// refused, not waved through. So the cost of setting this too low is that a burst of unique
    /// addresses starts refusing legitimate recovery requests — visible and recoverable — rather
    /// than silently disabling the limit, which is what an earlier implementation did. Size it
    /// well above the number of distinct addresses plus client addresses you expect inside one
    /// <see cref="RequestWindow"/>.
    /// </para>
    /// </remarks>
    public int MaxTrackedKeys { get; set; } = 50_000;

    /// <summary>
    /// Gets or sets the floor on how long a recovery request takes to answer. The found-an-account
    /// branch does more work than the other; the floor hides that from the clock.
    /// <see cref="TimeSpan.Zero"/> disables it.
    /// </summary>
    public TimeSpan MinimumResponseDuration { get; set; } = TimeSpan.FromMilliseconds(250);

    /// <summary>Validates the members that have no safe default.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (this.WebBaseUrl is null || !this.WebBaseUrl.IsAbsoluteUri)
        {
            return $"{SectionName}:{nameof(this.WebBaseUrl)} must be an absolute URL.";
        }

        if (this.WebBaseUrl.Scheme is not ("http" or "https"))
        {
            return $"{SectionName}:{nameof(this.WebBaseUrl)} must use http or https.";
        }

        if (!this.PasswordResetPath.StartsWith('/'))
        {
            return $"{SectionName}:{nameof(this.PasswordResetPath)} must start with '/'.";
        }

        if (!this.SecureAccountPath.StartsWith('/'))
        {
            return $"{SectionName}:{nameof(this.SecureAccountPath)} must start with '/'.";
        }

        if (this.TokenLifetime <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.TokenLifetime)} must be positive.";
        }

        // A mistyped override binds to 0 and reads as "refuse everything". Refuse to start instead.
        return FirstNonPositive(
            (nameof(this.RequestsPerEmail), this.RequestsPerEmail),
            (nameof(this.RequestsPerAddress), this.RequestsPerAddress),
            (nameof(this.RedemptionsPerAddress), this.RedemptionsPerAddress),
            (nameof(this.SignUpSendsPerAddress), this.SignUpSendsPerAddress),
            (nameof(this.SignUpVerifiesPerAddress), this.SignUpVerifiesPerAddress),
            (nameof(this.IdentifiesPerAddress), this.IdentifiesPerAddress),
            (nameof(this.IdentifiesPerEmail), this.IdentifiesPerEmail),
            (nameof(this.MaxTrackedKeys), this.MaxTrackedKeys));
    }

    private static string? FirstNonPositive(params (string Name, int Value)[] limits)
    {
        foreach (var (name, value) in limits)
        {
            if (value <= 0)
            {
                return $"{SectionName}:{name} must be positive.";
            }
        }

        return null;
    }
}
