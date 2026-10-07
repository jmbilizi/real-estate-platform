// <copyright file="IdentifyService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Routes an email to the password step or the code step (#653).
/// </summary>
/// <remarks>
/// <para>
/// The route is revealed on purpose (stakeholder default, recorded on #653). A confirmed, active
/// account goes to <see cref="IdentifyNext.Password"/>. Every other valid address goes to
/// <see cref="IdentifyNext.Code"/> through the #652 start logic. That includes a soft-deleted
/// account, an unconfirmed account, a pending sign-up and an address that cannot receive mail.
/// </para>
/// <para>
/// Both routes return the same JSON shape. A refusal on the code route (cooldown, hourly or daily
/// cap, lock) does not show as a <c>429</c>. It answers <c>code</c> with the wait in
/// <c>resendAfterSeconds</c> and the full code life, so a pending or locked address looks like a
/// fresh one. The code route spends the same send budget as <c>/signup/start</c>, so identify
/// cannot send more notices to one inbox than start does.
/// </para>
/// <para>
/// Nothing here logs the email.
/// </para>
/// </remarks>
/// <param name="users">The user manager, for the one account lookup.</param>
/// <param name="signUp">The #652 sign-up logic.</param>
/// <param name="limiter">The rate limiter, for the send budget.</param>
/// <param name="codeOptions">The engine options.</param>
internal sealed class IdentifyService(
    UserManager<ApplicationUser> users,
    SignUpService signUp,
    AccountRecoveryRateLimiter limiter,
    IOptions<EmailCodeOptions> codeOptions)
{
    /// <summary>Picks the next step for an address.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="clientAddress">The client address the send budget counts against.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<IdentifyResult> IdentifyAsync(
        string? email,
        string? clientAddress,
        CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new IdentifyResult(IdentifyStatus.InvalidEmail);
        }

        // One status for every address when the engine has no key, so the status shows no route.
        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new IdentifyResult(IdentifyStatus.Unavailable);
        }

        var user = await users.FindByEmailAsync(entered).ConfigureAwait(false);
        if (user is { EmailConfirmed: true, DeletedAt: null })
        {
            return new IdentifyResult(IdentifyStatus.Ok, IdentifyNext.Password);
        }

        var expires = EmailCodeService.CeilSeconds(settings.Lifetime);
        if (!limiter.TrySignUpSend(key, clientAddress, settings.ResendCooldown, settings.MaxPerHour, settings.MaxPerDay, out var wait))
        {
            return new IdentifyResult(IdentifyStatus.Ok, IdentifyNext.Code, EmailCodeService.CeilSeconds(wait), expires);
        }

        var started = await signUp.StartAsync(entered, cancellationToken).ConfigureAwait(false);
        return started.Status switch
        {
            SignUpStatus.Ok => new IdentifyResult(
                IdentifyStatus.Ok, IdentifyNext.Code, started.ResendAfterSeconds, started.ExpiresInSeconds),
            SignUpStatus.Limited => new IdentifyResult(
                IdentifyStatus.Ok, IdentifyNext.Code, Math.Max(1, started.RetryAfterSeconds), expires),
            SignUpStatus.InvalidEmail => new IdentifyResult(IdentifyStatus.InvalidEmail),
            _ => new IdentifyResult(IdentifyStatus.Unavailable),
        };
    }
}
