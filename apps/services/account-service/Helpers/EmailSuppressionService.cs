// <copyright file="EmailSuppressionService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Helpers;

/// <summary>
/// Reads and writes the table of addresses Postmark will not deliver to (#664).
/// Every call is idempotent. Nothing here logs the address.
/// </summary>
/// <param name="db">The database.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class EmailSuppressionService(AccountDbContext db, TimeProvider timeProvider)
{
    /// <summary>Checks whether an address is suppressed.</summary>
    /// <param name="key">The normalized address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns><see langword="true"/> when a row exists for the address.</returns>
    internal Task<bool> IsSuppressedAsync(string key, CancellationToken cancellationToken = default) =>
        db.EmailSuppressions.AnyAsync(s => s.Email == key, cancellationToken);

    /// <summary>Suppresses an address. An address that is already suppressed keeps its first row.</summary>
    /// <param name="key">The normalized address.</param>
    /// <param name="reason">Why the address is suppressed.</param>
    /// <param name="source">Where the fact came from.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the row exists.</returns>
    internal async Task SuppressAsync(string key, string reason, string source, CancellationToken cancellationToken = default)
    {
        if (await this.IsSuppressedAsync(key, cancellationToken).ConfigureAwait(false))
        {
            return;
        }

        db.EmailSuppressions.Add(new EmailSuppression
        {
            Id = Guid.NewGuid(),
            Email = key,
            Reason = reason,
            Source = source,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // A parallel call inserted the row first. The address is suppressed either way.
            db.ChangeTracker.Clear();
            if (!await this.IsSuppressedAsync(key, cancellationToken).ConfigureAwait(false))
            {
                throw;
            }
        }
    }

    /// <summary>Removes the suppression of an address. An address with no row stays as it is.</summary>
    /// <param name="key">The normalized address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the row is gone.</returns>
    internal async Task ReactivateAsync(string key, CancellationToken cancellationToken = default)
    {
        var row = await db.EmailSuppressions.FirstOrDefaultAsync(s => s.Email == key, cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            return;
        }

        db.EmailSuppressions.Remove(row);
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // A parallel call removed the row first.
            db.ChangeTracker.Clear();
        }
    }
}
