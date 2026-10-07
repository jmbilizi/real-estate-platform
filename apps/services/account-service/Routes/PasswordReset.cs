// <copyright file="PasswordReset.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;

namespace AccountService.Routes;

/// <summary>
/// Password reset by emailed code (#658). All three steps are anonymous. They share
/// <see cref="AccountRecoveryThrottleFilter"/>, which holds the per-address and per-email limits and
/// the response-time floor.
/// </summary>
/// <remarks>
/// A finished reset signs nobody in. It ends every session, so the client sends the user to sign in.
/// </remarks>
internal static class PasswordReset
{
    internal const string InvalidProofError = "invalid_proof";
    internal const string PasswordRejectedError = "password_rejected";

    internal static IEndpointRouteBuilder MapPasswordResetRoutes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/account/password/reset");
        group.AddEndpointFilter<AccountRecoveryThrottleFilter>();

        // POST /account/password/reset/start — { email } -> { resendAfterSeconds, expiresInSeconds }
        group.MapPost("/start", async (PasswordResetStartRequest request, PasswordResetService service, HttpContext http) =>
            SignUp.ToResult(http, await service.StartAsync(request.Email, http.RequestAborted).ConfigureAwait(false)));

        // POST /account/password/reset/verify — { email, code } -> { resetProof, expiresInSeconds }
        group.MapPost("/verify", async (PasswordResetVerifyRequest request, PasswordResetService service, HttpContext http) =>
            SignUp.ToResult(http, await service.VerifyAsync(request.Email, request.Code, http.RequestAborted).ConfigureAwait(false), "resetProof"));

        // POST /account/password/reset/complete — { email, resetProof, newPassword } -> 204
        group.MapPost("/complete", async (PasswordResetCompleteRequest request, PasswordResetService service, HttpContext http) =>
        {
            var result = await service
                .CompleteAsync(
                    request.Email,
                    request.ResetProof,
                    request.NewPassword,
                    AccountRecoveryThrottleFilter.ClientAddress(http),
                    http.RequestAborted)
                .ConfigureAwait(false);

            return result.Status switch
            {
                PasswordResetCompleteStatus.Done => Results.NoContent(),
                PasswordResetCompleteStatus.PasswordRejected => Results.Json(
                    new { error = PasswordRejectedError, errors = result.Errors },
                    statusCode: StatusCodes.Status400BadRequest),
                _ => Results.Json(new { error = InvalidProofError }, statusCode: StatusCodes.Status401Unauthorized),
            };
        });

        return app;
    }
}
