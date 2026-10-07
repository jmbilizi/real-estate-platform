// <copyright file="AccountRecoveryThrottleFilter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Globalization;
using AccountService.Configuration;
using AccountService.Dtos;
using Microsoft.AspNetCore.Identity.Data;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Applies the rate limits and the response-timing floor to Identity's own endpoints.
/// </summary>
/// <remarks>
/// <para>
/// The handlers are the framework's. An endpoint filter runs after model binding and before the
/// handler, which is where a limit consulted before any account lookup belongs, and it wraps the
/// handler so the response can be held to the floor.
/// </para>
/// <para>
/// The endpoint is identified by the bound request type, not the path. The arguments are searched,
/// not indexed: <c>GET /confirmEmail</c> has no request DTO.
/// </para>
/// <para>
/// A refused call answers <c>429</c> with <c>Retry-After</c> and is not padded. A refusal is
/// distinguishable by design, so there is no oracle to hide.
/// </para>
/// </remarks>
/// <param name="rateLimiter">The shared counters.</param>
/// <param name="options">The account-recovery options.</param>
/// <param name="codeOptions">The email code options. The sign-up send limits follow its resend caps.</param>
internal sealed class AccountRecoveryThrottleFilter(
    AccountRecoveryRateLimiter rateLimiter,
    IOptions<AccountRecoveryOptions> options,
    IOptions<EmailCodeOptions> codeOptions) : IEndpointFilter
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

        bool allowed;
        TimeSpan retryAfter;

        switch (FindRequest(context))
        {
            case ForgotPasswordRequest forgot:
                allowed = rateLimiter.TryRequest(Normalise(forgot.Email), clientAddress, out retryAfter);
                break;

            case ResetPasswordRequest:
                allowed = rateLimiter.TryRedemption(clientAddress, out retryAfter);
                break;

            case ResendConfirmationEmailRequest resend:
                allowed = rateLimiter.TryResend(Normalise(resend.Email), clientAddress, out retryAfter);
                break;

            case RegisterRequest:
                allowed = rateLimiter.TryRegistration(clientAddress, out retryAfter);
                break;

            case IdentifyRequest identify:
                allowed = rateLimiter.TryIdentify(
                    SignUpEmail.TryNormalize(identify.Email, out var identifyKey, out _) ? identifyKey : null,
                    clientAddress,
                    out retryAfter);
                break;

            case SignUpStartRequest start:
                allowed = this.TrySignUpSend(start.Email, clientAddress, out retryAfter);
                break;

            case SignUpResendRequest signUpResend:
                allowed = this.TrySignUpSend(signUpResend.Email, clientAddress, out retryAfter);
                break;

            case SignUpVerifyRequest or SignUpCompleteRequest:
                allowed = rateLimiter.TrySignUpVerify(clientAddress, out retryAfter);
                break;

            case SignUpChangeEmailRequest change:
                if (!SignUpEmail.TryNormalize(change.OldEmail, out var oldKey, out _)
                    || !SignUpEmail.TryNormalize(change.NewEmail, out var newKey, out _))
                {
                    allowed = rateLimiter.TrySignUpInvalid(clientAddress, out retryAfter);
                    break;
                }

                var codes = codeOptions.Value;
                allowed = rateLimiter.TrySignUpChange(
                    oldKey,
                    newKey,
                    clientAddress,
                    codes.ResendCooldown,
                    codes.MaxPerHour,
                    codes.MaxPerDay,
                    out retryAfter);
                break;

            case LoginRequest:
                // No limit of ours: Identity owns lockout. The floor is the point. Without it an
                // unknown address answers in about a millisecond and a real account pays PBKDF2,
                // which restores by stopwatch the oracle IdentityResponseShapingFilter removes
                // from the body.
                return await PaddedAsync(context, next, startedAt).ConfigureAwait(false);

            default:
                // Refresh, confirmEmail and manage/* pass through.
                return await next(context).ConfigureAwait(false);
        }

        if (!allowed)
        {
            return TooManyRequests(context.HttpContext, retryAfter);
        }

        return await PaddedAsync(context, next, startedAt).ConfigureAwait(false);
    }

    /// <summary>
    /// The address the per-caller limits count against.
    /// </summary>
    /// <remarks>
    /// Every external request arrives through Ocelot, so <c>RemoteIpAddress</c> is the gateway pod
    /// for all of them and a peer-keyed limit becomes one global bucket. <c>X-Real-IP</c> is what
    /// the gateway forwards and what its own limits key on. The gateway derives it, so a caller
    /// cannot set it (#143). The per-email limits do not depend on the caller's claim.
    /// </remarks>
    /// <param name="context">The request.</param>
    /// <returns>The client address, or <see langword="null"/> when unknown.</returns>
    internal static string? ClientAddress(HttpContext context)
    {
        var realIp = context.Request.Headers["X-Real-IP"].ToString();
        if (!string.IsNullOrWhiteSpace(realIp))
        {
            return realIp.Trim();
        }

        return context.Connection.RemoteIpAddress?.ToString();
    }

    private static object? FindRequest(EndpointFilterInvocationContext context)
    {
        for (var i = 0; i < context.Arguments.Count; i++)
        {
            if (context.Arguments[i] is ForgotPasswordRequest
                or ResetPasswordRequest
                or ResendConfirmationEmailRequest
                or RegisterRequest
                or IdentifyRequest
                or SignUpStartRequest
                or SignUpResendRequest
                or SignUpVerifyRequest
                or SignUpCompleteRequest
                or SignUpChangeEmailRequest
                or LoginRequest)
            {
                return context.Arguments[i];
            }
        }

        return null;
    }

    private static string Normalise(string? email) => email?.Trim() ?? string.Empty;

    private static IResult TooManyRequests(HttpContext context, TimeSpan retryAfter)
    {
        context.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds))
            .ToString(CultureInfo.InvariantCulture);

        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    private static async Task PadAsync(long startedAt, TimeSpan floor)
    {
        if (floor <= TimeSpan.Zero)
        {
            return;
        }

        var remaining = floor - Stopwatch.GetElapsedTime(startedAt);
        if (remaining > TimeSpan.Zero)
        {
            // RequestAborted is not observed. The work is done by now; a cancel here would only
            // replace a uniform 200 with an exception out of the filter.
            await Task.Delay(remaining, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private bool TrySignUpSend(string? email, string? clientAddress, out TimeSpan retryAfter)
    {
        // An address that fails the syntax check gets a 400. It counts against the caller only.
        if (!SignUpEmail.TryNormalize(email, out var key, out _))
        {
            return rateLimiter.TrySignUpInvalid(clientAddress, out retryAfter);
        }

        var codes = codeOptions.Value;
        return rateLimiter.TrySignUpSend(key, clientAddress, codes.ResendCooldown, codes.MaxPerHour, codes.MaxPerDay, out retryAfter);
    }

    private async ValueTask<object?> PaddedAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next,
        long startedAt)
    {
        var result = await next(context).ConfigureAwait(false);
        await PadAsync(startedAt, options.Value.MinimumResponseDuration).ConfigureAwait(false);
        return result;
    }
}
