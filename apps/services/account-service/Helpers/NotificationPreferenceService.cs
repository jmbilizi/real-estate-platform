// <copyright file="NotificationPreferenceService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Dtos;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Helpers;

/// <summary>
/// Reads and writes notification consent and answers the policy lookup (#694, #783, #769).
/// An account with no row has not opted in. Every change writes an audit row. Nothing here logs an address.
/// </summary>
/// <param name="db">The database.</param>
/// <param name="tokens">The unsubscribe token signer.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class NotificationPreferenceService(
    AccountDbContext db,
    UnsubscribeTokenService tokens,
    TimeProvider timeProvider)
{
    /// <summary>The most items one policy call accepts.</summary>
    internal const int MaxPolicyBatch = 100;

    /// <summary>The longest consent wording stored, in characters.</summary>
    internal const int MaxConsentTextLength = 1000;

    /// <summary>Checks a PUT body. Nothing is written when any item fails.</summary>
    /// <param name="request">The body.</param>
    /// <returns>The HTTP status and error code of the first failure, or <see langword="null"/> when the body is valid.</returns>
    internal static (int Status, string Error)? Validate(NotificationPreferencesRequest? request)
    {
        var items = request?.Items;
        if (items is null || items.Length is 0 or > 4 || items.Any(i => i is null))
        {
            return (StatusCodes.Status400BadRequest, "items_required");
        }

        var seen = new HashSet<string>();
        foreach (var item in items)
        {
            if (item.Channel is null || !NotificationChannels.All.Contains(item.Channel))
            {
                return (StatusCodes.Status400BadRequest, "invalid_channel");
            }

            if (item.Category == NotificationCategories.Transactional)
            {
                return (StatusCodes.Status400BadRequest, "transactional_not_storable");
            }

            if (item.Category != NotificationCategories.NonTransactional)
            {
                return (StatusCodes.Status400BadRequest, "invalid_category");
            }

            if (item.Enabled is null)
            {
                return (StatusCodes.Status400BadRequest, "enabled_required");
            }

            if (!seen.Add($"{item.Channel}|{item.Category}"))
            {
                return (StatusCodes.Status400BadRequest, "duplicate_item");
            }

            if (item.Enabled == true && item.Channel == NotificationChannels.Sms)
            {
                return (StatusCodes.Status409Conflict, "sms_requires_consent");
            }

            if (item.Enabled == true && string.IsNullOrWhiteSpace(item.ConsentText))
            {
                return (StatusCodes.Status400BadRequest, "consent_text_required");
            }

            if (item.ConsentText is { Length: > MaxConsentTextLength })
            {
                return (StatusCodes.Status400BadRequest, "consent_text_too_long");
            }
        }

        return null;
    }

    /// <summary>Lists the stored-capable preferences of an account, with the default for each missing row.</summary>
    /// <param name="accountId">The account id.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>One entry per channel for the non-transactional category.</returns>
    internal async Task<IReadOnlyList<object>> ListAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var rows = await db.NotificationPreferences
            .AsNoTracking()
            .Where(p => p.AccountId == accountId)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return NotificationChannels.All
            .Select(channel =>
            {
                var row = rows.FirstOrDefault(p => p.Channel == channel && p.Category == NotificationCategories.NonTransactional);
                return (object)new
                {
                    channel,
                    category = NotificationCategories.NonTransactional,
                    enabled = row?.Enabled ?? false,
                    source = row?.Source ?? NotificationSources.Default,
                    updatedAt = row?.UpdatedAt,
                    consentedAt = row?.ConsentedAt,
                };
            })
            .ToList();
    }

    /// <summary>Applies a validated PUT body. An item that changes nothing writes nothing.</summary>
    /// <param name="accountId">The signed-in account.</param>
    /// <param name="items">The validated items.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the rows are saved.</returns>
    internal async Task ApplyUserChangesAsync(string accountId, IEnumerable<NotificationPreferenceItem> items, CancellationToken cancellationToken = default)
    {
        foreach (var item in items)
        {
            await this.SetAsync(
                accountId,
                accountId,
                item.Channel!,
                NotificationCategories.NonTransactional,
                item.Enabled!.Value,
                NotificationSources.User,
                item.ConsentText?.Trim(),
                cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Opts an account out of one category by email. A repeat call changes nothing.</summary>
    /// <param name="accountId">The account id from a valid token.</param>
    /// <param name="category">The category from a valid token.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the opt-out is stored.</returns>
    internal async Task UnsubscribeAsync(string accountId, string category, CancellationToken cancellationToken = default)
    {
        var exists = await db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == accountId && u.DeletedAt == null, cancellationToken)
            .ConfigureAwait(false);
        if (!exists)
        {
            return;
        }

        await this.SetAsync(
            accountId,
            null,
            NotificationChannels.Email,
            category,
            false,
            NotificationSources.UnsubscribeLink,
            null,
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Answers a batch of policy questions. Unknown and soft-deleted accounts are omitted.</summary>
    /// <param name="queries">The validated questions.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>One answer per known account, in request order.</returns>
    internal async Task<IReadOnlyList<NotificationPolicyItem>> PolicyAsync(IReadOnlyList<NotificationPolicyQuery> queries, CancellationToken cancellationToken = default)
    {
        var ids = queries.Select(q => q.AccountId.ToString("D")).Distinct().ToList();
        var users = (await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.DeletedAt == null)
            .Select(u => new { u.Id, u.Email, u.EmailConfirmed })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false)).ToDictionary(u => u.Id);

        var rows = (await db.NotificationPreferences
            .AsNoTracking()
            .Where(p => ids.Contains(p.AccountId) && p.Category == NotificationCategories.NonTransactional)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false)).ToDictionary(p => $"{p.AccountId}|{p.Channel}");

        var keys = users.Values
            .Select(u => SignUpEmail.TryNormalize(u.Email, out var key, out _) ? key : null)
            .Where(k => k is not null)
            .Distinct()
            .ToList();
        var suppressed = (await db.EmailSuppressions
            .AsNoTracking()
            .Where(s => keys.Contains(s.Email))
            .Select(s => s.Email)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false)).ToHashSet();

        var answers = new List<NotificationPolicyItem>(queries.Count);
        foreach (var query in queries)
        {
            var id = query.AccountId.ToString("D");
            if (!users.TryGetValue(id, out var user))
            {
                continue;
            }

            var channel = query.Channel!;
            var category = query.Category!;
            var isSuppressed = channel == NotificationChannels.Email
                && SignUpEmail.TryNormalize(user.Email, out var emailKey, out _)
                && suppressed.Contains(emailKey);

            var needsConsent = NotificationCategories.NeedsConsent(category);
            string? token = null;
            if (needsConsent && channel == NotificationChannels.Email)
            {
                token = tokens.Create(id, NotificationCategories.NonTransactional);
            }

            // A missing row is "not opted in". Marketing and alert mail also needs the unsubscribe
            // token, so a missing signing key closes it (CAN-SPAM).
            var allowed = !needsConsent
                || (rows.TryGetValue($"{id}|{channel}", out var row) && row.Enabled
                    && (channel != NotificationChannels.Email || token is not null));

            answers.Add(new NotificationPolicyItem(query.AccountId, channel, category, allowed, isSuppressed, user.EmailConfirmed, token));
        }

        return answers;
    }

    private async Task SetAsync(
        string accountId,
        string? actorId,
        string channel,
        string category,
        bool enabled,
        string source,
        string? consentText,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            var now = timeProvider.GetUtcNow().UtcDateTime;
            var row = await db.NotificationPreferences
                .FirstOrDefaultAsync(p => p.AccountId == accountId && p.Channel == channel && p.Category == category, cancellationToken)
                .ConfigureAwait(false);

            if (row is not null && row.Enabled == enabled && (!enabled || row.ConsentText == consentText))
            {
                return;
            }

            db.NotificationPreferenceAudits.Add(new NotificationPreferenceAudit
            {
                Id = Guid.NewGuid(),
                AccountId = accountId,
                ActorId = actorId,
                Channel = channel,
                Category = category,
                PreviousEnabled = row?.Enabled,
                Enabled = enabled,
                Source = source,
                ConsentText = enabled ? consentText : null,
                OccurredAt = now,
            });

            if (row is null)
            {
                row = new NotificationPreference { AccountId = accountId, Channel = channel, Category = category };
                db.NotificationPreferences.Add(row);
            }

            row.Enabled = enabled;
            row.Source = source;
            row.UpdatedAt = now;
            if (enabled)
            {
                row.ConsentText = consentText;
                row.ConsentedAt = now;
            }

            try
            {
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // A parallel call inserted the row first. Read it and apply the change once more.
                db.ChangeTracker.Clear();
            }
        }
    }
}
