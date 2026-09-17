// <copyright file="AccountRecoveryThrottleFilter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Globalization;
using AccountService.Configuration;
using Microsoft.AspNetCore.Identity.Data;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Applies this service's rate limits and its response-timing floor to ASP.NET Core Identity's own
/// endpoints.
/// </summary>
/// <remarks>
/// <para>
/// The handlers are the framework's, so there is nowhere inside them to put this. An endpoint filter
/// is the seam that reaches them: it runs after model binding and before the handler, which is
/// exactly where a limit consulted <em>before any account lookup</em> belongs, and it wraps the
/// handler so the response can be held to a floor afterwards.
/// </para>
/// <para>
/// <b>Which endpoint is this?</b> Discriminated on the <em>bound argument type</em> rather than the
/// request path. <c>ForgotPasswordRequest</c>, <c>ResetPasswordRequest</c>,
/// <c>ResendConfirmationEmailRequest</c> and <c>RegisterRequest</c> are the public
/// <c>[FromBody]</c> parameter types of Identity's handlers, so matching on them is precise and
/// survives a path change upstream, where a hardcoded path string would silently stop matching. The
/// arguments are searched rather than indexed: the DTO is at index 0 on the four endpoints that
/// have one, but <c>GET /confirmEmail</c> has no DTO at all (three <c>[FromQuery]</c> strings), so
/// an index-0 cast would throw there.
/// </para>
/// <para>
/// A refused call answers <c>429</c> with <c>Retry-After</c> and is deliberately <em>not</em> padded
/// to the floor: a rate-limit response is distinguishable from an accepted one by design, so there
/// is no oracle to hide, and making an attacker's refusals slow only slows this process down too.
/// </para>
/// </remarks>
/// <param name="rateLimiter">The shared recovery-surface counters.</param>
/// <param name="options">The account-recovery options.</param>
internal sealed class AccountRecoveryThrottleFilter(
    AccountRecoveryRateLimiter rateLimiter,
    IOptions<AccountRecoveryOptions> options) : IEndpointFilter
{
    /// <inheritdoc/>
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var startedAt = Stopwatch.GetTimestamp();
        var clientAddress = ClientAddress(context.HttpContext);

        // Whether this endpoint is one whose timing must not be readable. The reset and resend
        // requests answer identically for a registered and an unregistered address, so the only
        // signal left is the clock. Registration is excluded: it already answers differently for a
        // known address (see the enumeration note on issue #136), so a floor would hide nothing.
        bool padResponse;
        bool allowed;
        TimeSpan retryAfter;

        switch (FindRequest(context))
        {
            case ForgotPasswordRequest forgot:
                allowed = rateLimiter.TryRequest(Normalise(forgot.Email), clientAddress, out retryAfter);
                padResponse = true;
                break;

            case ResendConfirmationEmailRequest resend:
                allowed = rateLimiter.TryResend(Normalise(resend.Email), clientAddress, out retryAfter);
                padResponse = true;
                break;

            case ResetPasswordRequest:
                allowed = rateLimiter.TryRedemption(clientAddress, out retryAfter);
                padResponse = true;
                break;

            case RegisterRequest:
                allowed = rateLimiter.TryRegistration(clientAddress, out retryAfter);
                padResponse = false;
                break;

            default:
                // Every other Identity endpoint — login, refresh, confirmEmail, manage/* — passes
                // through untouched. Login has Identity's lockout; the rest are not part of the
                // recovery surface this filter owns.
                return await next(context).ConfigureAwait(false);
        }

        if (!allowed)
        {
            return TooManyRequests(context.HttpContext, retryAfter);
        }

        var result = await next(context).ConfigureAwait(false);

        if (padResponse)
        {
            await PadAsync(startedAt, options.Value.MinimumResponseDuration).ConfigureAwait(false);
        }

        return result;
    }

    /// <summary>
    /// Finds the bound request DTO among the handler's arguments, if this endpoint has one this
    /// filter cares about.
    /// </summary>
    private static object? FindRequest(EndpointFilterInvocationContext context)
    {
        for (var i = 0; i < context.Arguments.Count; i++)
        {
            if (context.Arguments[i] is ForgotPasswordRequest
                or ResetPasswordRequest
                or ResendConfirmationEmailRequest
                or RegisterRequest)
            {
                return context.Arguments[i];
            }
        }

        return null;
    }

    private static string Normalise(string? email) => email?.Trim() ?? string.Empty;

    /// <summary>
    /// The address the per-caller limits are counted against.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>RemoteIpAddress</c> is the wrong answer here and dangerously so: every external request
    /// arrives through Ocelot, so the peer address is the gateway pod's for all of them, and the
    /// per-caller limit would become one global bucket that a handful of unrelated users could
    /// exhaust — turning a limit meant to stop abuse into a denial of recovery for everyone.
    /// </para>
    /// <para>
    /// <c>X-Real-IP</c> is what the gateway forwards and what Ocelot's own per-route limits key on
    /// (<c>Ocelot.Settings.json</c> → <c>ClientIdHeader</c>), so this agrees with the edge rather
    /// than inventing a second notion of caller. It is caller-asserted and therefore evadable by
    /// anyone willing to vary the header — the same weakness the gateway's limits already have. The
    /// per-email limits are the ones that do not depend on the caller's own claim about who they
    /// are, which is why both exist. Making the forwarded value trustworthy is issue #143.
    /// </para>
    /// </remarks>
    private static string? ClientAddress(HttpContext context)
    {
        var realIp = context.Request.Headers["X-Real-IP"].ToString();
        if (!string.IsNullOrWhiteSpace(realIp))
        {
            return realIp.Trim();
        }

        return context.Connection.RemoteIpAddress?.ToString();
    }

    private static IResult TooManyRequests(HttpContext context, TimeSpan retryAfter)
    {
        context.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds))
            .ToString(CultureInfo.InvariantCulture);

        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    /// <summary>
    /// Holds the response until the configured floor has elapsed, so the work actually done is not
    /// readable from the clock.
    /// </summary>
    private static async Task PadAsync(long startedAt, TimeSpan floor)
    {
        if (floor <= TimeSpan.Zero)
        {
            return;
        }

        var remaining = floor - Stopwatch.GetElapsedTime(startedAt);
        if (remaining > TimeSpan.Zero)
        {
            // Deliberately not observing RequestAborted. The token has already been issued by the
            // time this runs, so honouring a disconnect here would only replace a uniform 200 with
            // a TaskCanceledException thrown out of the filter.
            await Task.Delay(remaining, CancellationToken.None).ConfigureAwait(false);
        }
    }
}
