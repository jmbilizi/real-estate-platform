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
/// <c>Sent</c> is false when the send budget or the code engine stopped the send. Every address
/// gets the same field, so it does not reveal the account.
/// </para>
/// <para>
/// Nothing here logs the email. A skipped send logs the counter name and the wait only.
/// </para>
/// </remarks>
/// <param name="users">The user manager, for the one account lookup.</param>
/// <param name="signUp">The #652 sign-up logic.</param>
/// <param name="limiter">The rate limiter, for the send budget.</param>
/// <param name="codeOptions">The engine options.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class IdentifyService(
    UserManager<ApplicationUser> users,
    SignUpService signUp,
    AccountRecoveryRateLimiter limiter,
    IOptions<EmailCodeOptions> codeOptions,
    ILogger<IdentifyService> logger)
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

        // Before the send budget: a cooldown must not hide an undeliverable address behind "code sent".
        if (await signUp.IsUndeliverableAsync(key, entered, cancellationToken).ConfigureAwait(false))
        {
            return new IdentifyResult(IdentifyStatus.Undeliverable);
        }

        var expires = EmailCodeService.CeilSeconds(settings.Lifetime);
        if (!limiter.TrySignUpSend(key, clientAddress, settings.ResendCooldown, settings.MaxPerHour, settings.MaxPerDay, out var wait, out var refusedBy))
        {
            var waitSeconds = EmailCodeService.CeilSeconds(wait);
            LogSendSkipped(logger, refusedBy ?? "unknown", waitSeconds);
            return new IdentifyResult(IdentifyStatus.Ok, IdentifyNext.Code, waitSeconds, expires, Sent: false);
        }

        var started = await signUp.StartAsync(entered, cancellationToken).ConfigureAwait(false);
        return started.Status switch
        {
            SignUpStatus.Ok => new IdentifyResult(
                IdentifyStatus.Ok, IdentifyNext.Code, started.ResendAfterSeconds, started.ExpiresInSeconds),
            SignUpStatus.Limited => this.Limited(started.RetryAfterSeconds, expires),
            SignUpStatus.InvalidEmail => new IdentifyResult(IdentifyStatus.InvalidEmail),
            SignUpStatus.Undeliverable => new IdentifyResult(IdentifyStatus.Undeliverable),
            _ => new IdentifyResult(IdentifyStatus.Unavailable),
        };
    }

    [LoggerMessage(1397, LogLevel.Information, "Identify skipped the code send: counter {Counter} refused, wait {WaitSeconds}s.", EventName = "IdentifySendSkipped")]
    private static partial void LogSendSkipped(ILogger logger, string counter, int waitSeconds);

    private IdentifyResult Limited(int retryAfterSeconds, int expires)
    {
        var waitSeconds = Math.Max(1, retryAfterSeconds);
        LogSendSkipped(logger, "start-limited", waitSeconds);
        return new IdentifyResult(IdentifyStatus.Ok, IdentifyNext.Code, waitSeconds, expires, Sent: false);
    }
}
