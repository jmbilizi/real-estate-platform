// <copyright file="NotificationPolicy.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;

namespace AccountService.Routes;

/// <summary>
/// Internal batch lookup the Notification Service calls before each send (#694). It joins the
/// account's consent with the suppression list (#664) and signs the unsubscribe token.
/// </summary>
internal static class NotificationPolicy
{
    private const string PolicyPath = "/internal/account/notification-policy";

    /// <summary>
    /// Maps <c>POST /internal/account/notification-policy</c>. Same trust as <see cref="CredentialIntrospection"/>:
    /// in-cluster only, no gateway route, hidden from OpenAPI. An unknown channel or category fails the whole call.
    /// </summary>
    /// <param name="app">The endpoint route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    internal static IEndpointRouteBuilder MapNotificationPolicyRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost(PolicyPath, async (
            HttpContext context,
            NotificationPolicyRequest? request,
            NotificationPreferenceService service) =>
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, max-age=0";
            context.Response.Headers.Pragma = "no-cache";

            var items = request?.Items;
            if (items is null || items.Length == 0 || items.Length > NotificationPreferenceService.MaxPolicyBatch)
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    detail: $"items must hold 1 to {NotificationPreferenceService.MaxPolicyBatch} entries.");
            }

            if (items.Any(i => i is null
                || i.Channel is null || !NotificationChannels.All.Contains(i.Channel)
                || i.Category is null || !NotificationCategories.IsKnown(i.Category)))
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    detail: "Every item needs a known channel and category.");
            }

            var answers = await service.PolicyAsync(items, context.RequestAborted).ConfigureAwait(false);
            return Results.Ok(new { items = answers });
        })
        .DisableAntiforgery()
        .ExcludeFromDescription();

        return app;
    }
}
