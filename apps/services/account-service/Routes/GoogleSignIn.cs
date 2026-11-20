// <copyright file="GoogleSignIn.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

/// <summary>
/// <c>POST /account/login/google</c>: signs in, or signs up, with a Google ID token (#1049).
/// Anonymous. It issues the session as <c>/account/login</c> does.
/// </summary>
internal static class GoogleSignIn
{
    internal const string UnavailableError = "google_unavailable";
    internal const string InvalidTokenError = "invalid_token";
    internal const string EmailNotVerifiedError = "email_not_verified";
    internal const string SignInFailedError = "sign_in_failed";

    internal static IEndpointRouteBuilder MapGoogleSignInRoutes(this IEndpointRouteBuilder app)
    {
        // POST /account/login/google?useCookies=true&useSessionCookies=false
        // { credential } -> the session, as /account/login issues it.
        app.MapPost("/account/login/google", async (
                GoogleSignInRequest request,
                GoogleSignInService service,
                SignInManager<ApplicationUser> signInManager,
                HttpContext http,
                bool? useCookies,
                bool? useSessionCookies) =>
            {
                var result = await service.SignInAsync(request.Credential, http.RequestAborted).ConfigureAwait(false);
                switch (result.Status)
                {
                    case GoogleSignInStatus.SignedIn:
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
                    case GoogleSignInStatus.NotConfigured:
                        return Results.Json(new { error = UnavailableError }, statusCode: StatusCodes.Status503ServiceUnavailable);
                    case GoogleSignInStatus.EmailNotVerified:
                        return Results.Json(new { error = EmailNotVerifiedError }, statusCode: StatusCodes.Status401Unauthorized);
                    case GoogleSignInStatus.Refused:
                        // The same answer for a soft-deleted and a locked account.
                        return Results.Json(new { error = SignInFailedError }, statusCode: StatusCodes.Status401Unauthorized);
                    default:
                        return Results.Json(new { error = InvalidTokenError }, statusCode: StatusCodes.Status401Unauthorized);
                }
            })
            .AddEndpointFilter<AccountRecoveryThrottleFilter>();

        return app;
    }
}
