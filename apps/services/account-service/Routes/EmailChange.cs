// <copyright file="EmailChange.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using System.Security.Claims;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

/// <summary>
/// Email change for a signed-in account (#660). Both steps need a cookie or bearer session. They
/// share <see cref="AccountRecoveryThrottleFilter"/>, which holds the limits and the response-time
/// floor.
/// </summary>
/// <remarks>
/// An API key cannot change the email: a leaked key must not become an account takeover. A finished
/// change ends every other session and issues a new session for the caller, as the same kind as
/// the old one.
/// </remarks>
internal static class EmailChange
{
    internal const string StepUpFailedError = "step_up_failed";
    internal const string InvalidCodeError = "invalid_code";
    internal const string SessionRequiredError = "session_required";

    internal static IEndpointRouteBuilder MapEmailChangeRoutes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/account/email/change").RequireAuthorization();
        group.AddEndpointFilter<AccountRecoveryThrottleFilter>();

        // POST /account/email/change/start — { newEmail, currentPassword | oldEmailCode }
        //   -> { resendAfterSeconds, expiresInSeconds }, or { stepUp: "oldEmailCode", ... } when sent neither
        group.MapPost("/start", async (EmailChangeStartRequest request, EmailChangeService service, HttpContext http) =>
        {
            var session = await SessionAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return SessionRequired();
            }

            var result = await service
                .StartAsync(session.UserId, request.NewEmail, request.CurrentPassword, request.OldEmailCode, http.RequestAborted)
                .ConfigureAwait(false);
            return ToResult(http, result);
        });

        // POST /account/email/change/verify — { code } -> a new session, as /account/login issues it
        group.MapPost("/verify", async (
            EmailChangeVerifyRequest request,
            EmailChangeService service,
            SignInManager<ApplicationUser> signInManager,
            HttpContext http) =>
        {
            var session = await SessionAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return SessionRequired();
            }

            var result = await service
                .VerifyAsync(session.UserId, request.Code, AccountRecoveryThrottleFilter.ClientAddress(http), http.RequestAborted)
                .ConfigureAwait(false);
            if (result.Status != EmailChangeStatus.Changed)
            {
                return ToResult(http, result);
            }

            // The new stamp ended the old session, this one included. SignInAsync builds the
            // principal from the changed account, so the new session carries the new stamp.
            signInManager.AuthenticationScheme = session.Bearer ? IdentityConstants.BearerScheme : IdentityConstants.ApplicationScheme;
            await signInManager.SignInAsync(result.User!, session.Persistent).ConfigureAwait(false);

            // The sign-in wrote the cookie or the bearer token body.
            return Results.Empty;
        });

        return app;
    }

    private static IResult SessionRequired() =>
        Results.Json(new { error = SessionRequiredError }, statusCode: StatusCodes.Status403Forbidden);

    private static IResult ToResult(HttpContext http, EmailChangeResult result)
    {
        switch (result.Status)
        {
            case EmailChangeStatus.Accepted:
                return Results.Ok(new
                {
                    resendAfterSeconds = result.ResendAfterSeconds,
                    expiresInSeconds = result.ExpiresInSeconds,
                });
            case EmailChangeStatus.StepUpRequired:
                return Results.Ok(new
                {
                    stepUp = "oldEmailCode",
                    resendAfterSeconds = result.ResendAfterSeconds,
                    expiresInSeconds = result.ExpiresInSeconds,
                });
            case EmailChangeStatus.InvalidEmail:
                return Results.Json(new { error = "invalid_email" }, statusCode: StatusCodes.Status400BadRequest);
            case EmailChangeStatus.StepUpFailed:
                return Results.Json(
                    new { error = StepUpFailedError, attemptsLeft = result.AttemptsLeft },
                    statusCode: StatusCodes.Status403Forbidden);
            case EmailChangeStatus.WrongCode:
                return Results.Json(
                    new { error = InvalidCodeError, attemptsLeft = result.AttemptsLeft },
                    statusCode: StatusCodes.Status400BadRequest);
            case EmailChangeStatus.Failed:
                // No tries left count here: the code was right and the swap did not happen.
                return Results.Json(new { error = InvalidCodeError }, statusCode: StatusCodes.Status400BadRequest);
            case EmailChangeStatus.Limited:
                http.Response.Headers.RetryAfter = Math.Max(1, result.RetryAfterSeconds).ToString(CultureInfo.InvariantCulture);
                return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            case EmailChangeStatus.NoAccount:
                return Results.Unauthorized();
            default:
                return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }

    /// <summary>
    /// Reads how the caller signed in. Returns null for an API key. The default policy has already
    /// run each scheme, and a handler keeps its result for the request, so these calls read that
    /// result and do not validate again after the swap rotates the stamp.
    /// </summary>
    private static async Task<SessionInfo?> SessionAsync(HttpContext http)
    {
        var userId = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId))
        {
            return null;
        }

        var bearer = await http.AuthenticateAsync(IdentityConstants.BearerScheme).ConfigureAwait(false);
        if (bearer.Succeeded)
        {
            return new SessionInfo(userId, true, false);
        }

        var cookie = await http.AuthenticateAsync(IdentityConstants.ApplicationScheme).ConfigureAwait(false);
        return cookie.Succeeded
            ? new SessionInfo(userId, false, cookie.Properties?.IsPersistent == true)
            : null;
    }

    private sealed record SessionInfo(string UserId, bool Bearer, bool Persistent);
}
