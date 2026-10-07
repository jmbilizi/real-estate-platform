// <copyright file="Identify.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;

namespace AccountService.Routes;

/// <summary>
/// <c>POST /account/identify</c>: the email-first entry call. Anonymous. It shares
/// <see cref="AccountRecoveryThrottleFilter"/> for the limits and the response-time floor.
/// </summary>
internal static class Identify
{
    internal static IEndpointRouteBuilder MapIdentifyRoutes(this IEndpointRouteBuilder app)
    {
        // { email } -> { next: "password" | "code", resendAfterSeconds, expiresInSeconds }
        app.MapPost("/account/identify", async (IdentifyRequest request, IdentifyService service, HttpContext http) =>
        {
            var result = await service.IdentifyAsync(request.Email, AccountRecoveryThrottleFilter.ClientAddress(http), http.RequestAborted).ConfigureAwait(false);
            return result.Status switch
            {
                IdentifyStatus.Ok => Results.Ok(new
                {
                    next = result.Next == IdentifyNext.Password ? "password" : "code",
                    resendAfterSeconds = result.ResendAfterSeconds,
                    expiresInSeconds = result.ExpiresInSeconds,
                }),
                IdentifyStatus.InvalidEmail => Results.Json(new { error = "invalid_email" }, statusCode: StatusCodes.Status400BadRequest),
                IdentifyStatus.Undeliverable => Results.Json(new { error = SignUp.UndeliverableError }, statusCode: StatusCodes.Status422UnprocessableEntity),
                _ => Results.StatusCode(StatusCodes.Status503ServiceUnavailable),
            };
        }).AddEndpointFilter<AccountRecoveryThrottleFilter>();

        return app;
    }
}
