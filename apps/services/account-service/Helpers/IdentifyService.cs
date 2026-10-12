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
/// <c>Outcome</c> says what the send did on the code route (#813). The reasons come from per-email
/// and per-client counters, the same for every address on that route.
/// </para>
/// <para>
/// Nothing here logs the email. Each call logs one line with the route and the outcome.
/// </para>
/// </remarks>
/// <param name="users">The user manager, for the one account lookup.</param>
/// <param name="signUp">The #652 sign-up logic.</param>
/// <param name="limiter">The rate limiter, for the send budget.</param>
/// <param name="codeOptions">The engine options.</param>
/// <param name="sender">The transport, asked only whether it can deliver.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class IdentifyService(
    UserManager<ApplicationUser> users,
    SignUpService signUp,
    AccountRecoveryRateLimiter limiter,
    IOptions<EmailCodeOptions> codeOptions,
    IOutboundEmailSender sender,
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
        var result = await this.RouteAsync(email, clientAddress, cancellationToken).ConfigureAwait(false);
        var route = result.Status != IdentifyStatus.Ok ? "none" : result.Next == IdentifyNext.Password ? "password" : "code";
        var outcome = result.Status switch
        {
            IdentifyStatus.Ok when result.Next == IdentifyNext.Password => "none",
            IdentifyStatus.Ok => result.Outcome.Reason() ?? "sent",
            IdentifyStatus.InvalidEmail => "invalid_email",
            IdentifyStatus.Undeliverable => "undeliverable",
            _ => "unavailable",
        };
        var level = result.Status == IdentifyStatus.Unavailable ? LogLevel.Warning : LogLevel.Information;
        LogOutcome(logger, level, route, outcome, result.ResendAfterSeconds);
        return result;
    }

    [LoggerMessage(EventId = 1397, EventName = "IdentifyOutcome", Message = "Identify answered: route {Route}, outcome {Outcome}, wait {WaitSeconds}s.")]
    private static partial void LogOutcome(ILogger logger, LogLevel level, string route, string outcome, int waitSeconds);

    private async Task<IdentifyResult> RouteAsync(
        string? email,
        string? clientAddress,
        CancellationToken cancellationToken)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new IdentifyResult(IdentifyStatus.InvalidEmail);
        }

        // One status for every address when codes cannot go out, so the status shows no route.
        var settings = codeOptions.Value;
        if (!settings.IsConfigured || !sender.CanSend)
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
            return new IdentifyResult(
                IdentifyStatus.Ok,
                IdentifyNext.Code,
                EmailCodeService.CeilSeconds(wait),
                expires,
                CodeSendOutcomeWire.FromCounter(refusedBy));
        }

        var started = await signUp.StartAsync(entered, cancellationToken).ConfigureAwait(false);
        return started.Status switch
        {
            SignUpStatus.Ok => new IdentifyResult(
                IdentifyStatus.Ok, IdentifyNext.Code, started.ResendAfterSeconds, started.ExpiresInSeconds, started.Outcome),
            SignUpStatus.Limited => new IdentifyResult(
                IdentifyStatus.Ok,
                IdentifyNext.Code,
                Math.Max(1, started.RetryAfterSeconds),
                expires,
                started.Outcome == CodeSendOutcome.Sent ? CodeSendOutcome.Cooldown : started.Outcome),
            SignUpStatus.InvalidEmail => new IdentifyResult(IdentifyStatus.InvalidEmail),
            SignUpStatus.Undeliverable => new IdentifyResult(IdentifyStatus.Undeliverable),
            _ => new IdentifyResult(IdentifyStatus.Unavailable),
        };
    }
}
