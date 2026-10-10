// <copyright file="LookingFor.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using AccountService.Data;
using AccountService.Dtos;
using AccountService.Helpers;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Routes;

/// <summary>
/// The "What I'm looking for" preferences of the signed-in account (#768). Every call reads and
/// writes the caller's own rows. The account id comes from the principal, never from the request.
/// The preference sends no email. Alerts need their own opt-in (#505, #769).
/// </summary>
internal static class LookingFor
{
    private static readonly JsonSerializerOptions PlaceJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    internal static IEndpointRouteBuilder MapLookingForRoutes(this IEndpointRouteBuilder app)
    {
        // GET /account/looking-for — the caller's preferences, newest change first. #364 reads this.
        app.MapGet("/account/looking-for", async (
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext dbContext) =>
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

            var rows = await dbContext.LookingForPreferences
                .AsNoTracking()
                .Where(p => p.UserId == user.Id)
                .ToListAsync()
                .ConfigureAwait(false);

            var items = rows.OrderByDescending(p => p.UpdatedAt).Select(ToItem).ToList();
            return Results.Ok(new { items, max = LookingForLimits.MaxPerAccount });
        }).RequireAuthorization();

        // PUT /account/looking-for/{id} — create or replace one preference. The client picks the id.
        app.MapPut("/account/looking-for/{id:guid}", async (
            Guid id,
            LookingForRequest request,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext dbContext,
            TimeProvider clock) =>
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

            var now = clock.GetUtcNow();
            var errors = LookingForValidator.Validate(request, DateOnly.FromDateTime(now.UtcDateTime));
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var row = await dbContext.LookingForPreferences
                .FirstOrDefaultAsync(p => p.UserId == user.Id && p.Id == id)
                .ConfigureAwait(false);

            var created = row is null;
            if (row is null)
            {
                var count = await dbContext.LookingForPreferences
                    .CountAsync(p => p.UserId == user.Id)
                    .ConfigureAwait(false);
                if (count >= LookingForLimits.MaxPerAccount)
                {
                    return Results.Json(
                        new { error = "limit_reached", max = LookingForLimits.MaxPerAccount },
                        statusCode: StatusCodes.Status409Conflict);
                }

                row = new LookingForPreference { Id = id, UserId = user.Id, CreatedAt = now.UtcDateTime };
                dbContext.LookingForPreferences.Add(row);
            }

            row.Intent = request.Intent!;
            row.PlacesJson = JsonSerializer.Serialize(request.Places, PlaceJson);
            row.PriceMin = request.PriceMin;
            row.PriceMax = request.PriceMax;
            row.BedsMin = request.BedsMin;
            row.BathsMin = request.BathsMin;
            row.HomeTypes = request.HomeTypes?.ToList() ?? new List<string>();
            row.WhenStart = request.WhenStart;
            row.WhenEnd = request.WhenStart is null ? null : request.WhenEnd;
            row.UpdatedAt = now.UtcDateTime;

            await dbContext.SaveChangesAsync().ConfigureAwait(false);

            var item = ToItem(row);
            return created
                ? Results.Created(new Uri($"/account/looking-for/{id}", UriKind.Relative), item)
                : Results.Ok(item);
        }).RequireAuthorization();

        // DELETE /account/looking-for/{id} — remove one preference. An absent id succeeds.
        app.MapDelete("/account/looking-for/{id:guid}", async (
            Guid id,
            ClaimsPrincipal principal,
            UserManager<ApplicationUser> userManager,
            AccountDbContext dbContext) =>
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

            var row = await dbContext.LookingForPreferences
                .FirstOrDefaultAsync(p => p.UserId == user.Id && p.Id == id)
                .ConfigureAwait(false);
            if (row is not null)
            {
                dbContext.LookingForPreferences.Remove(row);
                await dbContext.SaveChangesAsync().ConfigureAwait(false);
            }

            return Results.NoContent();
        }).RequireAuthorization();

        return app;
    }

    private static object ToItem(LookingForPreference p) => new
    {
        id = p.Id,
        intent = p.Intent,
        places = JsonSerializer.Deserialize<List<LookingForPlace>>(p.PlacesJson, PlaceJson) ?? new List<LookingForPlace>(),
        priceMin = p.PriceMin,
        priceMax = p.PriceMax,
        bedsMin = p.BedsMin,
        bathsMin = p.BathsMin,
        homeTypes = p.HomeTypes,
        whenStart = p.WhenStart,
        whenEnd = p.WhenEnd,
        createdAt = p.CreatedAt,
        updatedAt = p.UpdatedAt,
    };
}
