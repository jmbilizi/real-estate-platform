// <copyright file="SignUp.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using AccountService.Dtos;
using AccountService.Helpers;

namespace AccountService.Routes;

/// <summary>
/// The sign-up steps before an account exists. All four are anonymous. They share
/// <see cref="AccountRecoveryThrottleFilter"/>, which holds the per-address and per-email limits and
/// the response-time floor. No step creates an account.
/// </summary>
internal static class SignUp
{
    internal static IEndpointRouteBuilder MapSignUpRoutes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/account/signup");
        group.AddEndpointFilter<AccountRecoveryThrottleFilter>();

        // POST /account/signup/start — { email } -> { resendAfterSeconds, expiresInSeconds }
        group.MapPost("/start", async (SignUpStartRequest request, SignUpService service, HttpContext http) =>
            ToResult(http, await service.StartAsync(request.Email, http.RequestAborted).ConfigureAwait(false)));

        // POST /account/signup/verify — { email, code } -> { signupProof, expiresInSeconds }
        group.MapPost("/verify", async (SignUpVerifyRequest request, SignUpService service, HttpContext http) =>
            ToResult(http, await service.VerifyAsync(request.Email, request.Code, http.RequestAborted).ConfigureAwait(false)));

        // POST /account/signup/resend — { email } -> { resendAfterSeconds, expiresInSeconds }
        group.MapPost("/resend", async (SignUpResendRequest request, SignUpService service, HttpContext http) =>
            ToResult(http, await service.ResendAsync(request.Email, http.RequestAborted).ConfigureAwait(false)));

        // POST /account/signup/change-email — { oldEmail, newEmail } -> as start, for the new address
        group.MapPost("/change-email", async (SignUpChangeEmailRequest request, SignUpService service, HttpContext http) =>
            ToResult(http, await service.ChangeEmailAsync(request.OldEmail, request.NewEmail, http.RequestAborted).ConfigureAwait(false)));

        return app;
    }

    private static IResult ToResult(HttpContext http, SignUpResult result)
    {
        switch (result.Status)
        {
            case SignUpStatus.Ok:
                return Results.Ok(new
                {
                    resendAfterSeconds = result.ResendAfterSeconds,
                    expiresInSeconds = result.ExpiresInSeconds,
                });
            case SignUpStatus.Verified:
                return Results.Ok(new
                {
                    signupProof = result.Proof,
                    expiresInSeconds = result.ExpiresInSeconds,
                });
            case SignUpStatus.WrongCode:
                return Results.Json(
                    new { error = "invalid_code", attemptsLeft = result.AttemptsLeft },
                    statusCode: StatusCodes.Status400BadRequest);
            case SignUpStatus.InvalidEmail:
                return Results.Json(new { error = "invalid_email" }, statusCode: StatusCodes.Status400BadRequest);
            case SignUpStatus.Limited:
                http.Response.Headers.RetryAfter = Math.Max(1, result.RetryAfterSeconds).ToString(CultureInfo.InvariantCulture);
                return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            default:
                return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }
}
