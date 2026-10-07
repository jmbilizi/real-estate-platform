// <copyright file="SecureAccount.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;

namespace AccountService.Routes;

/// <summary>
/// The "This wasn't me" link of #662. The call is anonymous: the token is the proof. It shares
/// <see cref="AccountRecoveryThrottleFilter"/>, which holds the limits and the response-time floor.
/// </summary>
internal static class SecureAccount
{
    internal const string InvalidTokenError = "invalid_token";

    internal static IEndpointRouteBuilder MapSecureAccountRoutes(this IEndpointRouteBuilder app)
    {
        // POST /account/secure — { token } -> { emailRestored }. A bad, used or expired token gives one 400.
        app.MapPost("/account/secure", async (SecureAccountRequest request, SecureAccountService service, HttpContext http) =>
        {
            var result = await service
                .SecureAsync(request.Token, AccountRecoveryThrottleFilter.ClientAddress(http), http.RequestAborted)
                .ConfigureAwait(false);

            return result.Secured
                ? Results.Json(new { emailRestored = result.EmailRestored })
                : Results.Json(new { error = InvalidTokenError }, statusCode: StatusCodes.Status400BadRequest);
        })
        .AddEndpointFilter<AccountRecoveryThrottleFilter>();

        return app;
    }
}
