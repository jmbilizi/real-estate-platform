// <copyright file="Waitlist.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Data;
using AccountService.Dtos;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AccountService.Routes;

/// <summary>
/// Early-access interest capture for the gated-preview pillars. Services and Connect are not open,
/// so these endpoints record interest only. They grant no access and promise no date.
/// <para>
/// Every endpoint reads and writes the calling account's own rows. The account id always comes from
/// the authenticated principal, never from the request, so one account cannot touch another's
/// interests.
/// </para>
/// </summary>
internal static class Waitlist
{
    internal static IEndpointRouteBuilder MapWaitlistRoutes(this IEndpointRouteBuilder app)
    {
        // GET /account/waitlist — list the caller's own early-access interests
        app.MapGet("/account/waitlist", async (
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

            var interests = await dbContext.WaitlistInterests
                .AsNoTracking()
                .Where(wi => wi.UserId == user.Id)
                .OrderBy(wi => wi.InterestKind)
                .Select(wi => new { interest = wi.InterestKind, registeredAt = wi.RegisteredAt })
                .ToListAsync()
                .ConfigureAwait(false);

            return Results.Ok(new { interests });
        }).RequireAuthorization();

        // POST /account/waitlist — register interest in one pillar; repeating it changes nothing
        app.MapPost("/account/waitlist", async (
            RegisterWaitlistInterestRequest request,
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

            var interest = request?.Interest;
            if (!WaitlistInterestKinds.IsValid(interest))
            {
                return InvalidInterest();
            }

            var alreadyRegistered = await dbContext.WaitlistInterests
                .AnyAsync(wi => wi.UserId == user.Id && wi.InterestKind == interest)
                .ConfigureAwait(false);

            if (alreadyRegistered)
            {
                return Results.NoContent();
            }

            dbContext.WaitlistInterests.Add(new WaitlistInterest
            {
                UserId = user.Id,
                InterestKind = interest!,
                RegisteredAt = DateTime.UtcNow,
            });

            try
            {
                await dbContext.SaveChangesAsync().ConfigureAwait(false);
            }
            catch (DbUpdateException exception) when (IsDuplicateKeyViolation(exception))
            {
                // Two concurrent registrations of the same pair: the composite primary key rejects
                // the loser. The account is registered either way, so report the same success.
                // Every other save failure stays unhandled, so a lost write surfaces as a 500
                // instead of a success the client would render as a durable registration.
                return Results.NoContent();
            }

            return Results.NoContent();
        }).RequireAuthorization();

        // DELETE /account/waitlist/{interest} — withdraw interest; withdrawing an absent one succeeds
        app.MapDelete("/account/waitlist/{interest}", async (
            string interest,
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

            // Withdrawal deliberately does not check the vocabulary. The lookup is already scoped to
            // the caller, so an unknown value finds no row and reports the same success as an
            // absent one. Checking here would strand a row whose kind the vocabulary later retires.
            var existing = await dbContext.WaitlistInterests
                .FirstOrDefaultAsync(wi => wi.UserId == user.Id && wi.InterestKind == interest)
                .ConfigureAwait(false);

            if (existing is null)
            {
                return Results.NoContent();
            }

            dbContext.WaitlistInterests.Remove(existing);
            await dbContext.SaveChangesAsync().ConfigureAwait(false);

            return Results.NoContent();
        }).RequireAuthorization();

        return app;
    }

    /// <summary>
    /// Reports whether the save failed because the row already exists. Postgres raises SQLSTATE
    /// 23505 for a unique or primary key violation.
    /// </summary>
    /// <param name="exception">The save failure.</param>
    /// <returns><see langword="true"/> for a duplicate-key violation.</returns>
    internal static bool IsDuplicateKeyViolation(DbUpdateException exception) =>
        exception?.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    // The rejected value is named, never echoed. Reflecting caller input into the response body
    // lets a client render text no user authored, and bounds nothing on its length.
    private static IResult InvalidInterest() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["interest"] =
            [
                $"Unknown interest. Valid values: {string.Join(", ", WaitlistInterestKinds.All.Order(StringComparer.Ordinal))}.",
            ],
        });
}
