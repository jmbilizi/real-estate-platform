// <copyright file="ContactLookup.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Dtos;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Routes;

/// <summary>
/// Internal service-to-service batch lookup of contact facts by account id (#689).
/// </summary>
internal static class ContactLookup
{
    internal const int MaxBatchSize = 100;

    private const string ContactsPath = "/internal/account/contacts";

    /// <summary>
    /// Maps <c>POST /internal/account/contacts</c>.
    /// </summary>
    /// <remarks>
    /// Same trust as <see cref="CredentialIntrospection"/>: in-cluster only, no gateway route, hidden
    /// from OpenAPI. Unknown and soft-deleted ids are omitted. The handler never logs an email or a
    /// display name.
    /// </remarks>
    /// <param name="app">The endpoint route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    internal static IEndpointRouteBuilder MapContactLookupRoutes(this IEndpointRouteBuilder app)
    {
        app.MapPost(ContactsPath, async (
            HttpContext context,
            ContactLookupRequest? request,
            AccountDbContext db) =>
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, max-age=0";
            context.Response.Headers.Pragma = "no-cache";

            var ids = request?.AccountIds;
            if (ids is null || ids.Length == 0 || ids.Length > MaxBatchSize)
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    detail: $"accountIds must hold 1 to {MaxBatchSize} ids.");
            }

            var keys = ids.Select(id => id.ToString("D")).Distinct().ToList();
            var found = await db.Users
                .AsNoTracking()
                .Where(u => keys.Contains(u.Id) && u.DeletedAt == null)
                .Select(u => new { u.Id, u.DisplayName, u.Email, u.EmailConfirmed })
                .ToListAsync(context.RequestAborted)
                .ConfigureAwait(false);

            var items = found
                .Select(u => new ContactLookupItem(Guid.Parse(u.Id), u.DisplayName, u.Email, u.EmailConfirmed))
                .ToList();
            return Results.Ok(new { contacts = items });
        })
        .DisableAntiforgery()
        .ExcludeFromDescription();

        return app;
    }
}
