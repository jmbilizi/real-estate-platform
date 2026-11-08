// <copyright file="RecentlyViewed.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Routes;

/// <summary>
/// The listing ids the signed-in account viewed last (#365). The account id comes from the
/// principal. The service stores the listing id and a time and nothing else.
/// </summary>
internal static class RecentlyViewed
{
    internal static IEndpointRouteBuilder MapRecentlyViewedRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost("/account/recently-viewed", async (
            RecentlyViewedRequest? request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            RecentlyViewedService service,
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

            if (!RecentlyViewedService.IsValidListingId(request?.ListingId))
            {
                return Results.Json(new { error = "invalid_listing_id" }, statusCode: StatusCodes.Status400BadRequest);
            }

            await service.RecordAsync(user.Id, request!.ListingId!, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/account/recently-viewed", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            RecentlyViewedService service,
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

            var ids = await service.ListAsync(user.Id, cancellationToken).ConfigureAwait(false);
            return Results.Ok(new { listingIds = ids });
        }).RequireAuthorization();

        return app;
    }
}
