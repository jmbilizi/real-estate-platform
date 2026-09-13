// <copyright file="PasswordReset.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Text;
using AccountService.Configuration;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace AccountService.Routes;

/// <summary>
/// Password recovery: issue a reset token for an address, and redeem one for a new password.
/// </summary>
/// <remarks>
/// <para>
/// These replace Identity's own <c>/forgotPassword</c> and <c>/resetPassword</c>, which this
/// service suppresses (see <see cref="IdentityApiSuppression"/>). Identity's request endpoint only
/// issues a token when <c>IsEmailConfirmedAsync</c> is true, and nothing in this platform confirms
/// an address, so it answered 200 having done nothing — for every account, forever. The token
/// machinery underneath is still Identity's: <c>GeneratePasswordResetTokenAsync</c> and
/// <c>ResetPasswordAsync</c>, not a scheme of our own.
/// </para>
/// <para><b>What the two endpoints promise.</b></para>
/// <list type="bullet">
/// <item>
/// The request endpoint answers identically — status, body and, within the configured floor,
/// elapsed time — whether or not the address names an account. It is not a membership oracle.
/// </item>
/// <item>
/// A token is single-use and time-bounded. Redeeming one rotates the account's security stamp,
/// which is itself part of the token's payload, so the same token cannot be redeemed twice.
/// </item>
/// <item>
/// Used, expired, tampered and unknown tokens all fail the same way. The response never says which.
/// </item>
/// <item>
/// A successful redemption rotates the account's security stamp, which invalidates its cookie
/// sessions on their very next request
/// (<c>SecurityStampValidatorOptions.ValidationInterval = Zero</c>) and its refresh tokens
/// immediately, since <c>/account/refresh</c> revalidates the stamp before issuing anything. One
/// residue survives: <c>Identity.Bearer</c> <em>access</em> tokens are self-contained and are
/// checked only against their own expiry, so a token already in an attacker's hands keeps working
/// until it expires on its own. That gap is service-wide — it is equally true of the revocation
/// <c>DELETE /account/profile</c> performs — and is tracked in issue #142 rather than papered over
/// here.
/// </item>
/// <item>
/// A successful redemption also clears any lockout, so an account locked by the password spraying
/// that prompted the reset is usable again the moment the reset completes.
/// </item>
/// </list>
/// </remarks>
internal static class PasswordReset
{
    /// <summary>The reset-request path.</summary>
    internal const string ForgotPath = "/account/password/forgot";

    /// <summary>The reset-confirmation path.</summary>
    internal const string ResetPath = "/account/password/reset";

    /// <summary>
    /// The single failure reported for every unusable token, whatever is wrong with it.
    /// </summary>
    private const string InvalidTokenMessage =
        "This password reset link is invalid or has expired. Request a new one.";

    /// <summary>
    /// Maps the password recovery endpoints.
    /// </summary>
    /// <param name="app">The endpoint route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    internal static IEndpointRouteBuilder MapPasswordResetRoutes(this IEndpointRouteBuilder app)
    {
        // POST /account/password/forgot — issue a reset token for an address, if it names an account.
        app.MapPost(ForgotPath, async (
            ForgotPasswordRequest request,
            HttpContext context,
            UserManager<ApplicationUser> userManager,
            IPasswordResetNotifier notifier,
            PasswordResetRateLimiter rateLimiter,
            IOptions<PasswordResetOptions> options,
            CancellationToken cancellationToken) =>
        {
            var startedAt = Stopwatch.GetTimestamp();
            var email = request.Email?.Trim() ?? string.Empty;

            if (!rateLimiter.TryRequest(email, ClientAddress(context), out var retryAfter))
            {
                return TooManyRequests(context, retryAfter);
            }

            // A blank address cannot name an account, but it must not short-circuit either: the
            // whole point is that every request takes the same shape and the same time.
            var user = email.Length == 0
                ? null
                : await userManager.FindByEmailAsync(email).ConfigureAwait(false);

            // A soft-deleted account is not recoverable through this flow, and says so by saying
            // nothing at all — the same 200 as an address that never existed.
            if (user is not null && user.DeletedAt is null)
            {
                var token = await userManager.GeneratePasswordResetTokenAsync(user).ConfigureAwait(false);
                var resetCode = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

                await notifier
                    .SendPasswordResetAsync(user.Email ?? email, resetCode, cancellationToken)
                    .ConfigureAwait(false);
            }

            await PadAsync(startedAt, options.Value.MinimumResponseDuration).ConfigureAwait(false);
            return Results.Ok();
        })
        .AllowAnonymous();

        // POST /account/password/reset — redeem a token and set a new password.
        app.MapPost(ResetPath, async (
            ResetPasswordRequest request,
            HttpContext context,
            UserManager<ApplicationUser> userManager,
            PasswordResetRateLimiter rateLimiter,
            IOptions<PasswordResetOptions> options,
            CancellationToken cancellationToken) =>
        {
            var startedAt = Stopwatch.GetTimestamp();
            var minimumDuration = options.Value.MinimumResponseDuration;

            if (!rateLimiter.TryRedemption(ClientAddress(context), out var retryAfter))
            {
                return TooManyRequests(context, retryAfter);
            }

            var email = request.Email?.Trim() ?? string.Empty;
            var user = email.Length == 0
                ? null
                : await userManager.FindByEmailAsync(email).ConfigureAwait(false);

            if (user is null || user.DeletedAt is not null || !TryDecode(request.ResetCode, out var token))
            {
                // Unknown address, deleted account, malformed code — one answer, no distinction.
                await PadAsync(startedAt, minimumDuration).ConfigureAwait(false);
                return InvalidToken();
            }

            var result = await userManager
                .ResetPasswordAsync(user, token, request.NewPassword ?? string.Empty)
                .ConfigureAwait(false);

            if (result.Succeeded)
            {
                await ClearLockoutAsync(userManager, user).ConfigureAwait(false);
            }

            await PadAsync(startedAt, minimumDuration).ConfigureAwait(false);

            if (result.Succeeded)
            {
                // ResetPasswordAsync rotates the security stamp as part of writing the new hash,
                // which is what burns this token and drops the account's cookie sessions and
                // refresh tokens.
                return Results.Ok();
            }

            // ResetPasswordAsync verifies the token before it validates the password, and reports
            // InvalidToken alone when the token is at fault. So reaching past this check means the
            // caller already held a valid token: telling them their chosen password is too short
            // discloses nothing they did not already have.
            if (result.Errors.Any(error =>
                string.Equals(error.Code, "InvalidToken", StringComparison.Ordinal)))
            {
                return InvalidToken();
            }

            return Results.ValidationProblem(result.Errors
                .GroupBy(e => e.Code)
                .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        })
        .AllowAnonymous();

        return app;
    }

    /// <summary>
    /// Releases any lockout on an account that has just completed a reset.
    /// </summary>
    /// <remarks>
    /// <c>ResetPasswordAsync</c> writes the new hash but leaves <c>LockoutEnd</c> and
    /// <c>AccessFailedCount</c> alone, and <c>/account/login</c> signs in with
    /// <c>lockoutOnFailure: true</c>. Without this, the very password spraying that locks an account
    /// also outlasts the recovery from it: the owner resets successfully and is then refused, with
    /// no explanation, for the remainder of the lockout — which the attacker can simply re-trigger.
    /// </remarks>
    /// <param name="userManager">The user manager.</param>
    /// <param name="user">The account that was just reset.</param>
    /// <returns>A task that completes when the lockout has been cleared.</returns>
    private static async Task ClearLockoutAsync(UserManager<ApplicationUser> userManager, ApplicationUser user)
    {
        await userManager.ResetAccessFailedCountAsync(user).ConfigureAwait(false);

        if (await userManager.GetLockoutEnabledAsync(user).ConfigureAwait(false))
        {
            await userManager.SetLockoutEndDateAsync(user, null).ConfigureAwait(false);
        }
    }

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
    /// per-email limit is the one that does not depend on the caller's own claim about who they
    /// are, which is why both exist. Making the forwarded value trustworthy is issue #143.
    /// </para>
    /// </remarks>
    /// <param name="context">The request context.</param>
    /// <returns>The caller's address, or null when none can be determined.</returns>
    private static string? ClientAddress(HttpContext context)
    {
        var realIp = context.Request.Headers["X-Real-IP"].ToString();
        if (!string.IsNullOrWhiteSpace(realIp))
        {
            return realIp.Trim();
        }

        return context.Connection.RemoteIpAddress?.ToString();
    }

    private static IResult InvalidToken() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["resetCode"] =
            [
                InvalidTokenMessage,
            ],
        });

    private static IResult TooManyRequests(HttpContext context, TimeSpan retryAfter)
    {
        context.Response.Headers.RetryAfter =
            ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);

        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    private static bool TryDecode(string? resetCode, out string token)
    {
        token = string.Empty;

        if (string.IsNullOrEmpty(resetCode))
        {
            return false;
        }

        try
        {
            token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(resetCode));
            return true;
        }
        catch (FormatException)
        {
            // A code that is not even Base64Url is just another unusable token.
            return false;
        }
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
            // a TaskCanceledException thrown out of the handler.
            await Task.Delay(remaining, CancellationToken.None).ConfigureAwait(false);
        }
    }
}
