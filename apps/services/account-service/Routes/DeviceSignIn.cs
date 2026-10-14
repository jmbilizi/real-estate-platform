// <copyright file="DeviceSignIn.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using AccountService.Configuration;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace AccountService.Routes;

/// <summary>
/// Email code on sign-in from a new device (#818). The setting and device list need a cookie or
/// bearer session. The two sign-in steps are anonymous and check the password again, so the code
/// alone proves nothing.
/// </summary>
/// <remarks>
/// The web app keeps the device token in an httpOnly cookie and passes it in
/// <see cref="DeviceTrustService.TokenHeader"/>. This service answers with the issued token in
/// <see cref="DeviceTrustService.IssuedTokenHeader"/>. An API key cannot change the setting.
/// </remarks>
internal static class DeviceSignIn
{
    internal const string InvalidCodeError = "invalid_code";
    internal const string StepUpFailedError = "step_up_failed";
    internal const string CodesUnavailableError = "codes_unavailable";

    internal static IEndpointRouteBuilder MapDeviceSignInRoutes(this IEndpointRouteBuilder app)
    {
        var login = app.MapGroup("/account/login");
        login.AddEndpointFilter<AccountRecoveryThrottleFilter>();

        // POST /account/login/device — { email, password, code } -> a session, as /account/login issues it.
        // The new device token is in the X-Device-Token-Issued response header.
        login.MapPost("/device", async (
            DeviceSignInRequest request,
            AppUserManager users,
            SignInManager<ApplicationUser> signInManager,
            EmailCodeService codes,
            DeviceTrustService devices,
            HttpContext http,
            [FromQuery] bool? useCookies,
            [FromQuery] bool? useSessionCookies) =>
        {
            var user = await CheckPasswordAsync(users, signInManager, request.Email, request.Password).ConfigureAwait(false);
            if (user.Failure is { } failure)
            {
                return failure;
            }

            var account = user.User!;
            if (!account.RequireDeviceCode)
            {
                return Results.Json(new { error = InvalidCodeError }, statusCode: StatusCodes.Status400BadRequest);
            }

            var verified = await codes.VerifyAsync(account.Email!, EmailCodePurpose.NewDeviceSignIn, request.Code, http.RequestAborted)
                .ConfigureAwait(false);
            switch (verified.Status)
            {
                case EmailCodeVerifyStatus.Verified:
                    break;
                case EmailCodeVerifyStatus.Locked:
                    return Limited(http, verified.RetryAfterSeconds);
                case EmailCodeVerifyStatus.Unavailable:
                    return Results.Json(new { error = CodesUnavailableError }, statusCode: StatusCodes.Status503ServiceUnavailable);
                default:
                    return Results.Json(
                        new { error = InvalidCodeError, attemptsLeft = verified.AttemptsLeft },
                        statusCode: StatusCodes.Status400BadRequest);
            }

            await IssueDeviceAsync(devices, http, account.Id).ConfigureAwait(false);

            // The same choice Identity's /login makes.
            var useCookieScheme = useCookies == true || useSessionCookies == true;
            signInManager.AuthenticationScheme = useCookieScheme ? IdentityConstants.ApplicationScheme : IdentityConstants.BearerScheme;
            await signInManager.SignInAsync(account, isPersistent: useCookies == true && useSessionCookies != true).ConfigureAwait(false);

            // The sign-in wrote the cookie or the bearer token body.
            return Results.Empty;
        });

        // POST /account/login/device/resend — { email, password } -> { resendAfterSeconds, expiresInSeconds, reason }
        login.MapPost("/device/resend", async (
            DeviceSignInResendRequest request,
            AppUserManager users,
            SignInManager<ApplicationUser> signInManager,
            DeviceSignInService sender,
            HttpContext http) =>
        {
            var user = await CheckPasswordAsync(users, signInManager, request.Email, request.Password).ConfigureAwait(false);
            if (user.Failure is { } failure)
            {
                return failure;
            }

            if (!user.User!.RequireDeviceCode)
            {
                return Results.Json(new { error = InvalidCodeError }, statusCode: StatusCodes.Status400BadRequest);
            }

            var send = await sender.SendAsync(user.User, http.RequestAborted).ConfigureAwait(false);
            return send.Status == EmailCodeIssueStatus.Unavailable
                ? Results.Json(new { error = CodesUnavailableError }, statusCode: StatusCodes.Status503ServiceUnavailable)
                : Results.Ok(new { resendAfterSeconds = send.ResendAfterSeconds, expiresInSeconds = send.ExpiresInSeconds, reason = send.Reason });
        });

        var security = app.MapGroup("/account/security").RequireAuthorization();

        // GET /account/security/new-device -> { enabled, devices: [...] }
        security.MapGet("/new-device", async (
            AppUserManager users,
            DeviceTrustService devices,
            HttpContext http) =>
        {
            var session = await CallerSession.ReadAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return SessionRequired();
            }

            var user = await users.FindByIdAsync(session.UserId).ConfigureAwait(false);
            if (user is null || user.DeletedAt is not null)
            {
                return Results.Unauthorized();
            }

            var current = await devices.FindAsync(session.UserId, http.Request.Headers[DeviceTrustService.TokenHeader].ToString(), http.RequestAborted)
                .ConfigureAwait(false);
            var rows = await devices.ListAsync(session.UserId, http.RequestAborted).ConfigureAwait(false);
            return Results.Ok(new
            {
                enabled = user.RequireDeviceCode,
                devices = rows.Select(d => new
                {
                    id = d.Id,
                    label = d.Label,
                    firstSeenAt = d.FirstSeenAt,
                    lastUsedAt = d.LastUsedAt,
                    current = current is not null && current.Id == d.Id,
                }),
            });
        });

        // PUT /account/security/new-device — { enabled, currentPassword } -> { enabled }. Step-up: the password.
        security.MapPut("/new-device", async (
            NewDeviceSettingRequest request,
            AppUserManager users,
            DeviceTrustService devices,
            IOptions<EmailCodeOptions> codeOptions,
            IOutboundEmailSender transport,
            TimeProvider timeProvider,
            HttpContext http) =>
        {
            var session = await CallerSession.ReadAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return SessionRequired();
            }

            var user = await users.FindByIdAsync(session.UserId).ConfigureAwait(false);
            if (user is null || user.DeletedAt is not null)
            {
                return Results.Unauthorized();
            }

            if (await users.IsLockedOutAsync(user).ConfigureAwait(false))
            {
                var end = await users.GetLockoutEndDateAsync(user).ConfigureAwait(false);
                var wait = end is { } until ? until - timeProvider.GetUtcNow() : codeOptions.Value.LockDuration;
                return Limited(http, EmailCodeService.CeilSeconds(wait));
            }

            if (string.IsNullOrEmpty(request.CurrentPassword)
                || !await users.HasPasswordAsync(user).ConfigureAwait(false)
                || !await users.CheckPasswordAsync(user, request.CurrentPassword).ConfigureAwait(false))
            {
                // Counts toward the same lock as a wrong password at sign-in.
                await users.AccessFailedAsync(user).ConfigureAwait(false);
                return Results.Json(new { error = StepUpFailedError }, statusCode: StatusCodes.Status403Forbidden);
            }

            await users.ResetAccessFailedCountAsync(user).ConfigureAwait(false);

            // Turning it on with no way to send a code would lock the owner out of new devices.
            if (request.Enabled && (!codeOptions.Value.IsConfigured || !transport.CanSend))
            {
                return Results.Json(new { error = CodesUnavailableError }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            user.RequireDeviceCode = request.Enabled;
            var updated = await users.UpdateAsync(user).ConfigureAwait(false);
            if (!updated.Succeeded)
            {
                return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }

            if (request.Enabled)
            {
                // The device that turned it on is trusted, so this sign-in does not prompt again.
                await IssueDeviceAsync(devices, http, user.Id).ConfigureAwait(false);
            }
            else
            {
                await devices.RemoveAllAsync(user.Id, http.RequestAborted).ConfigureAwait(false);
            }

            return Results.Ok(new { enabled = user.RequireDeviceCode });
        });

        // DELETE /account/security/new-device/devices/{id} -> 204. The device asks for a code at its next sign-in.
        security.MapDelete("/new-device/devices/{id:guid}", async (Guid id, DeviceTrustService devices, HttpContext http) =>
        {
            var session = await CallerSession.ReadAsync(http).ConfigureAwait(false);
            if (session is null)
            {
                return SessionRequired();
            }

            return await devices.RemoveAsync(session.UserId, id, http.RequestAborted).ConfigureAwait(false)
                ? Results.NoContent()
                : Results.NotFound();
        });

        return app;
    }

    private static async Task IssueDeviceAsync(DeviceTrustService devices, HttpContext http, string userId)
    {
        var token = await devices.IssueAsync(userId, http.Request.Headers[DeviceTrustService.LabelHeader].ToString(), http.RequestAborted)
            .ConfigureAwait(false);
        if (token is null)
        {
            return;
        }

        http.Response.Headers[DeviceTrustService.IssuedTokenHeader] = token;
        http.Response.Headers[DeviceTrustService.IssuedMaxAgeHeader] =
            ((int)devices.Lifetime.TotalSeconds).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Finds the account and checks the password. A wrong password counts toward the lock.</summary>
    private static async Task<(ApplicationUser? User, IResult? Failure)> CheckPasswordAsync(
        AppUserManager users,
        SignInManager<ApplicationUser> signInManager,
        string? email,
        string? password)
    {
        IResult failed = Results.Problem(Microsoft.AspNetCore.Identity.SignInResult.Failed.ToString(), statusCode: StatusCodes.Status401Unauthorized);
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
        {
            return (null, failed);
        }

        var user = await users.FindByNameAsync(email).ConfigureAwait(false);
        if (user is null || user.DeletedAt is not null || user.Email is null)
        {
            return (null, failed);
        }

        var check = await signInManager.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true).ConfigureAwait(false);
        return check.Succeeded ? (user, null) : (null, failed);
    }

    private static IResult Limited(HttpContext http, int retryAfterSeconds)
    {
        http.Response.Headers.RetryAfter = Math.Max(1, retryAfterSeconds).ToString(CultureInfo.InvariantCulture);
        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    private static IResult SessionRequired() =>
        Results.Json(new { error = EmailChange.SessionRequiredError }, statusCode: StatusCodes.Status403Forbidden);
}
