// <copyright file="DeviceSignInFilter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.Data;

namespace AccountService.Helpers;

/// <summary>
/// Stops a password sign-in from an unrecognized device when the account asks for an emailed code
/// (#818). It runs over Identity's <c>/login</c> handler.
/// </summary>
/// <remarks>
/// <para>
/// Only a correct password reaches the challenge. A wrong password, a lock and every account with
/// the setting off fall through to Identity's handler, so the answers and the lockout count stay
/// the framework's. A recognized device signs in as before.
/// </para>
/// <para>
/// With the setting on and no way to send a code, the filter answers <c>503</c> and signs nobody in.
/// It fails closed because the user chose the extra step.
/// </para>
/// </remarks>
/// <param name="users">The user manager.</param>
/// <param name="signInManager">The sign-in manager. It checks the password and signs nobody in.</param>
/// <param name="devices">The trusted device service.</param>
/// <param name="sender">The code sender.</param>
internal sealed class DeviceSignInFilter(
    AppUserManager users,
    SignInManager<ApplicationUser> signInManager,
    DeviceTrustService devices,
    DeviceSignInService sender) : IEndpointFilter
{
    /// <summary>The error code of the challenge answer.</summary>
    internal const string RequiredError = "device_code_required";

    /// <inheritdoc/>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var login = context.Arguments.OfType<LoginRequest>().FirstOrDefault();
        if (login is null || string.IsNullOrEmpty(login.Email) || string.IsNullOrEmpty(login.Password))
        {
            return await next(context).ConfigureAwait(false);
        }

        var http = context.HttpContext;
        var user = await users.FindByNameAsync(login.Email).ConfigureAwait(false);
        if (user is null || !user.RequireDeviceCode || user.DeletedAt is not null || user.Email is null)
        {
            return await next(context).ConfigureAwait(false);
        }

        var device = await devices.FindAsync(user.Id, http.Request.Headers[DeviceTrustService.TokenHeader].ToString(), http.RequestAborted)
            .ConfigureAwait(false);
        if (device is not null)
        {
            var result = await next(context).ConfigureAwait(false);
            var inner = result is INestedHttpResult nested ? nested.Result : result;
            if (inner is not ProblemHttpResult)
            {
                await devices.TouchAsync(device, http.RequestAborted).ConfigureAwait(false);
            }

            return result;
        }

        var check = await signInManager.CheckPasswordSignInAsync(user, login.Password, lockoutOnFailure: false).ConfigureAwait(false);
        if (!check.Succeeded)
        {
            return await next(context).ConfigureAwait(false);
        }

        var send = await sender.SendAsync(user, http.RequestAborted).ConfigureAwait(false);
        if (send.Status == EmailCodeIssueStatus.Unavailable)
        {
            return Results.Json(new { error = "codes_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Json(
            new
            {
                error = RequiredError,
                resendAfterSeconds = send.ResendAfterSeconds,
                expiresInSeconds = send.ExpiresInSeconds,
                reason = send.Reason,
            },
            statusCode: StatusCodes.Status401Unauthorized);
    }
}
