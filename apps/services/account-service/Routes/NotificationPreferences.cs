// <copyright file="NotificationPreferences.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

/// <summary>
/// Notification consent of the signed-in account and the one-click unsubscribe (#694, #783, #769).
/// The account id comes from the principal, never from the request. Transactional mail has no row
/// and cannot be switched off. Nothing here logs an address.
/// </summary>
internal static class NotificationPreferences
{
    internal const string UnsubscribePath = "/notifications/unsubscribe";

    internal static IEndpointRouteBuilder MapNotificationPreferenceRoutes(this IEndpointRouteBuilder app)
    {
        app.MapGet("/account/notification-preferences", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            NotificationPreferenceService service,
            CancellationToken cancellationToken) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            return Results.Ok(await BuildAsync(service, user.Id, cancellationToken).ConfigureAwait(false));
        }).RequireAuthorization();

        app.MapPut("/account/notification-preferences", async (
            NotificationPreferencesRequest? request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            NotificationPreferenceService service,
            CancellationToken cancellationToken) =>
        {
            var user = await userManager.GetUserAsync(principal).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (user.DeletedAt.HasValue)
            {
                return Results.NotFound();
            }

            var failure = NotificationPreferenceService.Validate(request);
            if (failure is { } error)
            {
                return Results.Json(new { error = error.Error }, statusCode: error.Status);
            }

            await service.ApplyUserChangesAsync(user.Id, request!.Items!, cancellationToken).ConfigureAwait(false);
            return Results.Ok(await BuildAsync(service, user.Id, cancellationToken).ConfigureAwait(false));
        }).RequireAuthorization();

        // RFC 8058 one-click: the mail client POSTs "List-Unsubscribe=One-Click" to the URL in the
        // List-Unsubscribe header. The signed token in the query is the only credential. The body is
        // not read. A valid token always answers 200, so a repeat call and a deleted account look alike.
        app.MapPost(UnsubscribePath, async (
            HttpContext context,
            NotificationPreferenceService service,
            UnsubscribeTokenService tokens) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var token = context.Request.Query["t"].ToString();

            // The token category is bound: the link opts the account out of exactly that category, and
            // only the stored category is valid. A token for another category is refused.
            if (!tokens.TryValidate(token, out var accountId, out var category) || category != NotificationCategories.NonTransactional)
            {
                return Results.Json(new { error = "invalid_token" }, statusCode: StatusCodes.Status400BadRequest);
            }

            await service.UnsubscribeAsync(accountId, category, context.RequestAborted).ConfigureAwait(false);
            return Results.Ok(new { status = "unsubscribed" });
        })
        .AllowAnonymous()
        .DisableAntiforgery();

        return app;
    }

    private static async Task<object> BuildAsync(NotificationPreferenceService service, string accountId, CancellationToken cancellationToken) => new
    {
        preferences = await service.ListAsync(accountId, cancellationToken).ConfigureAwait(false),
        transactional = new { enabled = true, editable = false },
        consentWording = new
        {
            id = ConsentWordings.EmailNonTransactional,
            version = ConsentWordings.EmailNonTransactionalVersion,
            text = ConsentWordings.EmailNonTransactionalText,
        },
    };
}
