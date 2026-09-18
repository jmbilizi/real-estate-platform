// <copyright file="AccountRecoveryOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Policy for the unauthenticated Identity surface: registration, email confirmation and resend.
/// Section <c>AccountRecovery</c>. Password reset (#136) adds its members here.
/// </summary>
/// <remarks>
/// Identity's endpoints ship with no rate limit and no timing floor. Every value here is a guarantee
/// this service adds on top of them. The defaults are the production values.
/// </remarks>
internal sealed class AccountRecoveryOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "AccountRecovery";

    /// <summary>
    /// Gets or sets a value indicating whether an unconfirmed account is refused at sign-in.
    /// Bound to <c>SignInOptions.RequireConfirmedAccount</c>. Every environment sets it explicitly.
    /// #149 turns it on.
    /// </summary>
    public bool RequireConfirmedEmail { get; set; }

    /// <summary>
    /// Gets or sets the public origin of the web app, for example <c>https://cribstop.com</c>.
    /// The confirmation link is built from it. Required. No default in code (PRD §1).
    /// </summary>
    public Uri? WebBaseUrl { get; set; }

    /// <summary>
    /// Gets or sets the web route that receives the confirmation link. The settled value is
    /// <c>/confirm-email</c> (stakeholder ruling 2026-09-16). Required.
    /// </summary>
    public string ConfirmationPath { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets how long a confirmation link stays valid. Enforced by the dedicated
    /// <c>EmailConfirmationTokenProvider</c>, so it does not change any other Identity token.
    /// </summary>
    public TimeSpan ConfirmationTokenLifetime { get; set; } = TimeSpan.FromHours(24);

    /// <summary>
    /// Gets or sets the minimum time between two confirmation sends for one address.
    /// <see cref="TimeSpan.Zero"/> disables the interval.
    /// </summary>
    public TimeSpan ResendMinimumInterval { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>Gets or sets the confirmation sends allowed for one address per hour.</summary>
    public int ResendsPerEmailPerHour { get; set; } = 3;

    /// <summary>Gets or sets the confirmation sends allowed for one address per 24 hours.</summary>
    public int ResendsPerEmailPerDay { get; set; } = 10;

    /// <summary>
    /// Gets or sets the resend requests allowed from one client address per
    /// <see cref="RequestWindow"/>.
    /// </summary>
    public int ResendsPerAddress { get; set; } = 10;

    /// <summary>
    /// Gets or sets the registration attempts allowed from one client address per
    /// <see cref="RequestWindow"/>. Loose on purpose: one client address is often many people
    /// behind one NAT.
    /// </summary>
    public int RegistrationsPerAddress { get; set; } = 30;

    /// <summary>Gets or sets the window for the per-client-address counters.</summary>
    public TimeSpan RequestWindow { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Gets or sets the cap on live rate-limit counters. At the cap the limiter refuses requests
    /// rather than stop counting. Size it well above the distinct addresses expected in one window.
    /// </summary>
    public int MaxTrackedKeys { get; set; } = 50_000;

    /// <summary>
    /// Gets or sets the floor on how long a register or resend request takes to answer. The
    /// found-an-account branch does more work than the other; the floor hides that from the clock.
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

        if (!this.ConfirmationPath.StartsWith('/'))
        {
            return $"{SectionName}:{nameof(this.ConfirmationPath)} must start with '/'.";
        }

        if (this.ConfirmationTokenLifetime <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.ConfirmationTokenLifetime)} must be positive.";
        }

        // A mistyped override binds to 0 and reads as "refuse everything". Refuse to start instead.
        return FirstNonPositive(
            (nameof(this.ResendsPerEmailPerHour), this.ResendsPerEmailPerHour),
            (nameof(this.ResendsPerEmailPerDay), this.ResendsPerEmailPerDay),
            (nameof(this.ResendsPerAddress), this.ResendsPerAddress),
            (nameof(this.RegistrationsPerAddress), this.RegistrationsPerAddress),
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
