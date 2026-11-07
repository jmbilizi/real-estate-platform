// <copyright file="RecentlyViewedService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.RegularExpressions;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AccountService.Helpers;

/// <summary>
/// Keeps the most recent listing ids an account viewed (#365). The newest id is first. A repeat
/// view moves the id to the front. The list holds at most <see cref="RecentlyViewedListing.MaxPerAccount"/> ids.
/// </summary>
/// <param name="db">The database.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed partial class RecentlyViewedService(AccountDbContext db, TimeProvider timeProvider)
{
    /// <summary>Checks a listing id. It must be a short opaque token.</summary>
    /// <param name="listingId">The id from the request.</param>
    /// <returns><see langword="true"/> when the id is acceptable.</returns>
    internal static bool IsValidListingId(string? listingId) =>
        listingId is not null && ListingIdPattern().IsMatch(listingId);

    /// <summary>Records a view. The caller has already checked the id.</summary>
    /// <param name="userId">The account id.</param>
    /// <param name="listingId">The viewed listing id.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the view is stored.</returns>
    internal async Task RecordAsync(string userId, string listingId, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var existing = await db.RecentlyViewedListings
            .SingleOrDefaultAsync(r => r.UserId == userId && r.ListingId == listingId, cancellationToken)
            .ConfigureAwait(false);
        if (existing is null)
        {
            db.RecentlyViewedListings.Add(new RecentlyViewedListing { UserId = userId, ListingId = listingId, ViewedAt = now });
        }
        else
        {
            existing.ViewedAt = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent call for the same id inserted the row first. The view is stored either way.
            db.ChangeTracker.Clear();
        }

        var excess = await db.RecentlyViewedListings
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.ViewedAt)
            .ThenBy(r => r.ListingId)
            .Skip(RecentlyViewedListing.MaxPerAccount)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (excess.Count > 0)
        {
            db.RecentlyViewedListings.RemoveRange(excess);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Lists the listing ids, newest first.</summary>
    /// <param name="userId">The account id.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The ids.</returns>
    internal async Task<IReadOnlyList<string>> ListAsync(string userId, CancellationToken cancellationToken = default) =>
        await db.RecentlyViewedListings
            .AsNoTracking()
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.ViewedAt)
            .ThenBy(r => r.ListingId)
            .Select(r => r.ListingId)
            .Take(RecentlyViewedListing.MaxPerAccount)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

    [GeneratedRegex("^[A-Za-z0-9._:-]{1,64}\\z", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex ListingIdPattern();
}
