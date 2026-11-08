// <copyright file="PropertyErasureService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Removes a deleted account's property-service rows (#803). <see cref="Stage"/> records the work
/// with the delete. <see cref="DrainAsync"/> makes the call and retries a failure on the next sweep.
/// A property-service outage never blocks the account delete.
/// </summary>
/// <param name="db">The account database.</param>
/// <param name="http">The client for property-service.</param>
/// <param name="caller">The shared internal key.</param>
/// <param name="options">The erasure options.</param>
/// <param name="timeProvider">The clock.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class PropertyErasureService(
    AccountDbContext db,
    HttpClient http,
    IOptions<InternalCallerOptions> caller,
    IOptions<PropertyErasureOptions> options,
    TimeProvider timeProvider,
    ILogger<PropertyErasureService> logger)
{
    /// <summary>
    /// Adds the pending row to the context without saving. The caller's next save writes it with the
    /// account change, so the two cannot diverge.
    /// </summary>
    /// <param name="accountId">The deleted account.</param>
    internal void Stage(string accountId)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        db.PendingPropertyErasures.Add(new PendingPropertyErasure
        {
            AccountId = accountId,
            CreatedAt = now,
            NextAttemptAt = now,
        });
    }

    /// <summary>Calls property-service for every account that is due. A failed call stays queued with a later retry time.</summary>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>How many accounts the call completed.</returns>
    internal async Task<int> DrainAsync(CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var due = await db.PendingPropertyErasures
            .Where(e => e.NextAttemptAt <= now)
            .OrderBy(e => e.NextAttemptAt)
            .Take(settings.BatchSize)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (due.Count == 0)
        {
            return 0;
        }

        var key = caller.Value.Key;
        var done = 0;
        foreach (var row in due)
        {
            var failure = await this.CallAsync(row.AccountId, key, cancellationToken).ConfigureAwait(false);
            if (failure is null)
            {
                db.PendingPropertyErasures.Remove(row);
                done++;
            }
            else
            {
                row.Attempts++;
                row.NextAttemptAt = now + Backoff(row.Attempts, settings.MaxBackoff);
                LogFailed(logger, row.Attempts, failure);
            }

            // One save per row, so a stop or a clash with another replica loses at most one row's bookkeeping.
            try
            {
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Another sweep already removed the row. The call is idempotent, so nothing is lost.
                db.Entry(row).State = EntityState.Detached;
            }
        }

        return done;
    }

    private static TimeSpan Backoff(int attempts, TimeSpan max)
    {
        var minutes = Math.Pow(2, Math.Min(attempts, 16));
        return TimeSpan.FromMinutes(Math.Min(minutes, max.TotalMinutes));
    }

    [LoggerMessage(1391, LogLevel.Warning, "Property data erasure failed on attempt {Attempts}: {Failure}. The next sweep retries.", EventName = "PropertyErasureFailed")]
    private static partial void LogFailed(ILogger logger, int attempts, string failure);

    /// <returns>Null on success, else a short failure label. It never holds the account id or the key.</returns>
    private async Task<string?> CallAsync(string accountId, string key, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Delete,
                new Uri(options.Value.BaseUrl, $"internal/account/{Uri.EscapeDataString(accountId)}/data"));
            request.Headers.TryAddWithoutValidation(InternalCallerOptions.HeaderName, key);
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode ? null : $"status {(int)response.StatusCode}";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // TaskCanceledException is the HttpClient timeout. A real shutdown has a cancelled token.
            cancellationToken.ThrowIfCancellationRequested();
            return ex.GetType().Name;
        }
    }
}
