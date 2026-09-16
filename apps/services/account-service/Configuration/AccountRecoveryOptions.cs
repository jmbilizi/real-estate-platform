// <copyright file="AccountRecoveryOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Strongly-typed options for the <c>AccountRecovery</c> configuration section: the policy over the
/// service's whole unauthenticated account-recovery surface — registration, email confirmation and
/// password reset.
/// </summary>
/// <remarks>
/// <para>
/// One options type rather than three because it is genuinely one policy. The endpoints it governs
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
    /// Gets or sets a value indicating whether a confirmed email address is required to sign in.
    /// Drives <c>SignInOptions.RequireConfirmedEmail</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Deliberately <see langword="false"/> until the transactional email provider exists.</b>
    /// Identity's <c>/register</c> issues a confirmation link through
    /// <c>IEmailSender&lt;ApplicationUser&gt;</c>, and until issue #133 provisions a provider,
    /// sending domain and per-environment credentials, nothing can deliver it. Turning this on
    /// before then would mean no one can create a usable account at all — the web app's signup route
    /// already posts to <c>/account/register</c> — which is a worse outcome than an unconfirmed
    /// address. The flip to <see langword="true"/> is owned by #138 and is a configuration change,
    /// not a code change: both states are covered by tests.
    /// </para>
    /// <para>
    /// Two things this flag does not do, because both get assumed. It is <b>not a revocation</b>:
    /// <c>/account/refresh</c> checks only the refresh token's own expiry and the security stamp —
    /// it never calls <c>CanSignInAsync</c> — so an already-issued refresh token keeps minting
    /// access tokens for an unconfirmed account until its own expiry or a stamp rotation. And
    /// turning it on <b>creates an enumeration oracle on <c>/account/login</c></b>:
    /// <c>PreSignInCheck</c> returns <c>SignInResult.NotAllowed</c> before the password is verified
    /// and Identity's handler puts <c>result.ToString()</c> into the problem <c>detail</c>, so an
    /// unknown address answers <c>"Failed"</c> and a registered-but-unconfirmed one answers
    /// <c>"NotAllowed"</c> for any password at all. Both are recorded on issue #136 for a product
    /// ruling rather than silently absorbed.
    /// </para>
    /// </remarks>
    public bool RequireConfirmedEmailToSignIn { get; set; }

    /// <summary>
    /// Gets or sets how long an issued password-reset token stays valid. Bound into the dedicated
    /// <c>PasswordResetTokenProvider</c>, so the configured value is the one actually enforced when
    /// a token is redeemed — not merely advertised.
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

    /// <summary>Gets or sets the number of password-reset requests allowed from one client address per <see cref="RequestWindow"/>.</summary>
    public int RequestsPerAddress { get; set; } = 15;

    /// <summary>
    /// Gets or sets the number of confirmation-email resends allowed for one email address per
    /// <see cref="RequestWindow"/>.
    /// </summary>
    /// <remarks>
    /// Identity's <c>/resendConfirmationEmail</c> does not gate on <c>IsEmailConfirmedAsync</c> at
    /// all: it mails a live confirmation link to any address that names an account, already
    /// confirmed or not. Unmetered, that is a mail cannon pointed at a third party's inbox, and the
    /// address it targets is chosen entirely by the caller. Counted separately from
    /// <see cref="RequestsPerEmail"/> so exhausting one does not consume the other.
    /// </remarks>
    public int ResendsPerEmail { get; set; } = 3;

    /// <summary>Gets or sets the number of confirmation-email resends allowed from one client address per <see cref="RequestWindow"/>.</summary>
    public int ResendsPerAddress { get; set; } = 10;

    /// <summary>
    /// Gets or sets the number of reset redemption attempts allowed from one client address per
    /// <see cref="RequestWindow"/>. Bounds token guessing; set higher than
    /// <see cref="RequestsPerAddress"/> because a legitimate user may retry a password that fails
    /// the policy several times in a row.
    /// </summary>
    public int RedemptionsPerAddress { get; set; } = 30;

    /// <summary>
    /// Gets or sets the number of registration attempts allowed from one client address per
    /// <see cref="RequestWindow"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Identity's <c>/register</c> is unauthenticated, creates rows, sends mail, and — see the note
    /// on issue #136 — discloses whether an address is already registered. A limit does not fix the
    /// disclosure, but it bounds how fast the surface can be harvested or the table filled while the
    /// disclosure is being decided.
    /// </para>
    /// <para>
    /// Deliberately the loosest limit here. Unlike a reset request, a registration is something a
    /// legitimate person does once — so the requests arriving from one address are far more likely
    /// to be several unrelated people behind an office NAT or a carrier's CGNAT than one attacker,
    /// and a tight cap denies a stranger a signup rather than stopping abuse. The gateway's own
    /// per-route Ocelot limit (5/min) is the coarse edge bound; this one exists to stop a sustained
    /// harvesting run, which is what the window rather than the count catches.
    /// </para>
    /// </remarks>
    public int RegistrationsPerAddress { get; set; } = 30;

    /// <summary>Gets or sets the fixed window over which every limit above is counted.</summary>
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
    /// Gets or sets the floor on how long a recovery request takes to answer.
    /// </summary>
    /// <remarks>
    /// Identity's <c>/forgotPassword</c> and <c>/resendConfirmationEmail</c> return an identical
    /// empty <c>200</c> whether or not the address names an account — but the branch that found one
    /// does a database hit, a token generation and an <c>await</c> on the email sender, while the
    /// branch that did not does almost nothing. That difference is a membership oracle which
    /// survives every effort to make the response bodies identical. Padding both outcomes up to a
    /// common floor removes the signal. Set to <see cref="TimeSpan.Zero"/> to disable.
    /// </remarks>
    public TimeSpan MinimumResponseDuration { get; set; } = TimeSpan.FromMilliseconds(250);
}
