// <copyright file="CredentialIntrospection.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

internal static class CredentialIntrospection
{
    private const string IntrospectionPath = "/internal/account/introspect";

    internal static IEndpointRouteBuilder MapCredentialIntrospectionRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost(IntrospectionPath, async (
            HttpContext context,
            IAuthenticationService authenticationService,
            SignInManager<ApplicationUser> signInManager,
            UserManager<ApplicationUser> userManager,
            CancellationToken cancellationToken) =>
        {
            SetNoStoreHeaders(context.Response);

            var requestType = ResolveCredentialType(context.Request);
            if (requestType is null)
            {
                return Results.Ok(IntrospectionResult.Invalid("none", revoked: false, expired: false));
            }

            var (authScheme, responseType) = requestType.Value;

            var authenticateResult = await authenticationService
                .AuthenticateAsync(context, authScheme)
                .ConfigureAwait(false);

            if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
            {
                var flags = ResolveInvalidFlags(authenticateResult.Failure?.Message);
                return Results.Ok(IntrospectionResult.Invalid(responseType, flags.Revoked, flags.Expired));
            }

            var accountId = authenticateResult.Principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrWhiteSpace(accountId))
            {
                return Results.Ok(IntrospectionResult.Invalid(responseType, revoked: false, expired: false));
            }

            // Ensure cookie/bearer credentials honor security-stamp revocation immediately.
            if (!string.Equals(authScheme, ApiKeyDefaults.AuthenticationScheme, StringComparison.Ordinal))
            {
                var stampValidatedUser = await signInManager
                    .ValidateSecurityStampAsync(authenticateResult.Principal)
                    .ConfigureAwait(false);

                if (stampValidatedUser is null || stampValidatedUser.DeletedAt.HasValue)
                {
                    return Results.Ok(IntrospectionResult.Invalid(responseType, revoked: true, expired: false));
                }

                accountId = stampValidatedUser.Id;
            }
            else
            {
                var apiKeyUser = await userManager.FindByIdAsync(accountId).ConfigureAwait(false);
                if (apiKeyUser is null || apiKeyUser.DeletedAt.HasValue)
                {
                    return Results.Ok(IntrospectionResult.Invalid(responseType, revoked: true, expired: false));
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            return Results.Ok(IntrospectionResult.Valid(responseType, accountId));
        })
        .DisableAntiforgery()
        .WithDescription("Internal service-to-service credential introspection endpoint.");

        return app;
    }

    private static (string AuthScheme, string ResponseType)? ResolveCredentialType(HttpRequest request)
    {
        if (request.Headers.TryGetValue(ApiKeyDefaults.HeaderName, out var apiKeyValue) &&
            !string.IsNullOrWhiteSpace(apiKeyValue.ToString()))
        {
            return (ApiKeyDefaults.AuthenticationScheme, "apiKey");
        }

        if (request.Headers.TryGetValue("Authorization", out var authValue) &&
            authValue.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return (IdentityConstants.BearerScheme, "bearer");
        }

        if (request.Headers.TryGetValue("Cookie", out var cookieValue) &&
            !string.IsNullOrWhiteSpace(cookieValue.ToString()))
        {
            return (IdentityConstants.ApplicationScheme, "cookie");
        }

        return null;
    }

    private static (bool Revoked, bool Expired) ResolveInvalidFlags(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return (false, false);
        }

        var revoked = message.Contains("revoked", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("security stamp", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("unavailable", StringComparison.OrdinalIgnoreCase);
        var expired = message.Contains("expired", StringComparison.OrdinalIgnoreCase);

        return (revoked, expired);
    }

    private static void SetNoStoreHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store, no-cache, max-age=0";
        response.Headers.Pragma = "no-cache";
        response.Headers.Expires = "0";
    }

    private sealed record IntrospectionResult(
        bool IsValid,
        string CredentialType,
        string? AccountId,
        bool IsRevoked,
        bool IsExpired)
    {
        internal static IntrospectionResult Valid(string credentialType, string accountId) =>
            new(true, credentialType, accountId, false, false);

        internal static IntrospectionResult Invalid(string credentialType, bool revoked, bool expired) =>
            new(false, credentialType, null, revoked, expired);
    }
}
