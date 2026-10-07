// <copyright file="SignUpComplete.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

/// <summary>
/// <c>POST /account/signup/complete</c>: the step that creates the account and signs it in (#654).
/// </summary>
internal static class SignUpComplete
{
    internal const string InvalidProofError = "invalid_proof";
    internal const string EmailUnavailableError = "email_unavailable";
    internal const string PasswordRejectedError = "password_rejected";

    internal static IEndpointRouteBuilder MapSignUpCompleteRoutes(this IEndpointRouteBuilder app)
    {
        // POST /account/signup/complete?useCookies=true&useSessionCookies=false
        // { email, signupProof, password } -> the session, as /account/login issues it.
        app.MapPost("/account/signup/complete", async (
                SignUpCompleteRequest request,
                SignUpCompletion completion,
                SignInManager<ApplicationUser> signInManager,
                HttpContext http,
                bool? useCookies,
                bool? useSessionCookies) =>
            {
                var result = await completion
                    .CompleteAsync(request.Email, request.SignupProof, request.Password, http.RequestAborted)
                    .ConfigureAwait(false);

                switch (result.Status)
                {
                    case SignUpCompleteStatus.Created:
                        // The same choice /account/login makes. SignInAsync runs AppSignInManager,
                        // so the session carries the security stamp and the app is recorded.
                        var useCookieScheme = useCookies == true || useSessionCookies == true;
                        var isPersistent = useCookies == true && useSessionCookies != true;
                        signInManager.AuthenticationScheme = useCookieScheme
                            ? IdentityConstants.ApplicationScheme
                            : IdentityConstants.BearerScheme;
                        await signInManager.SignInAsync(result.User!, isPersistent).ConfigureAwait(false);

                        // The sign-in wrote the cookie or the bearer token body.
                        return Results.Empty;
                    case SignUpCompleteStatus.PasswordRejected:
                        return Results.Json(
                            new { error = PasswordRejectedError, errors = result.Errors },
                            statusCode: StatusCodes.Status400BadRequest);
                    case SignUpCompleteStatus.EmailUnavailable:
                        return Results.Json(
                            new { error = EmailUnavailableError },
                            statusCode: StatusCodes.Status409Conflict);
                    default:
                        return Results.Json(
                            new { error = InvalidProofError },
                            statusCode: StatusCodes.Status401Unauthorized);
                }
            })
            .AddEndpointFilter<AccountRecoveryThrottleFilter>();

        return app;
    }
}
