// <copyright file="SecureAccountService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The "This wasn't me" link of #662. A valid token is used up once. In one transaction the service
/// then ends every session, drops the password, and writes the audit row. If the token is for an
/// email change that is inside its restore window and the old address is free, the old address comes
/// back in the same transaction.
/// </summary>
/// <remarks>
/// The password hash is removed, so the account has no password until the owner resets it by
/// emailed code (#658). An unknown, used or expired token gives one answer. Nothing here logs the
/// token or an address.
/// </remarks>
/// <param name="db">The account database.</param>
/// <param name="users">The user manager.</param>
/// <param name="codeOptions">The engine options. They hold the audit hash key.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class SecureAccountService(
    AccountDbContext db,
    AppUserManager users,
    IOptions<EmailCodeOptions> codeOptions,
    TimeProvider timeProvider)
{
    private const int MaxTokenLength = 256;
    private const int MaxAttempts = 3;

    private enum RestoreOutcome
    {
        /// <summary>No restore applies, or the address is taken.</summary>
        None,

        /// <summary>The old address is back.</summary>
        Restored,

        /// <summary>Identity refused the old address. The caller rolls back and secures without a restore.</summary>
        Refused,
    }

    /// <summary>Uses the token and secures the account.</summary>
    /// <param name="token">The token from the link.</param>
    /// <param name="clientAddress">The client address, or null. The audit row holds a hash.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SecureAccountResult> SecureAsync(
        string? token,
        string? clientAddress,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength)
        {
            return new SecureAccountResult(false);
        }

        var hash = SecurityNoticeService.HashToken(token);
        var allowRestore = true;
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var step = await this.TryAsync(hash, allowRestore, clientAddress, cancellationToken).ConfigureAwait(false);
            if (step.Result is not null)
            {
                return step.Result;
            }

            allowRestore &= !step.DropRestore;
        }

        return new SecureAccountResult(false);
    }

    private static async Task RollbackAsync(IDbContextTransaction? transaction)
    {
        if (transaction is not null)
        {
            await transaction.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async Task<Step> TryAsync(
        byte[] hash,
        bool allowRestore,
        string? clientAddress,
        CancellationToken cancellationToken)
    {
        // A retry must not see the state of a rolled-back try.
        db.ChangeTracker.Clear();
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var row = await db.SecureAccountTokens
            .FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken)
            .ConfigureAwait(false);
        if (row is null || row.ConsumedAt is not null || row.ExpiresAt <= now)
        {
            return Step.Done(new SecureAccountResult(false));
        }

        var user = await users.FindByIdAsync(row.UserId).ConfigureAwait(false);
        if (user is null || user.DeletedAt is not null)
        {
            return Step.Done(new SecureAccountResult(false));
        }

        var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false)
            : null;
        await using (transaction)
        {
            try
            {
                // The version token lets one call win. A second call fails here and then sees a used token.
                row.ConsumedAt = now;
                row.Version++;
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

                var key = codeOptions.Value.HmacKey;
                var before = user.Email;
                var outcome = allowRestore && row.Kind == AccountSecurityEvent.EmailChanged
                    ? await this.TryRestoreEmailAsync(user, row.CreatedAt, now, cancellationToken).ConfigureAwait(false)
                    : RestoreOutcome.None;
                if (outcome == RestoreOutcome.Refused)
                {
                    await RollbackAsync(transaction).ConfigureAwait(false);
                    return Step.Again(dropRestore: true);
                }

                var restored = outcome == RestoreOutcome.Restored;

                // No hash means no password sign-in. The owner sets a new password by emailed code.
                user.PasswordHash = null;
                user.UpdatedAt = now;

                var pending = await db.PendingEmailChanges
                    .Where(p => p.UserId == user.Id)
                    .ToListAsync(cancellationToken)
                    .ConfigureAwait(false);
                db.PendingEmailChanges.RemoveRange(pending);

                // Saves the user with the new stamp. The stamp ends every cookie and bearer session.
                var stamped = await users.UpdateSecurityStampAsync(user).ConfigureAwait(false);
                if (!stamped.Succeeded)
                {
                    throw new InvalidOperationException(
                        "The account was not secured: " + string.Join(", ", stamped.Errors.Select(e => e.Code)));
                }

                db.AccountSecurityEvents.Add(new AccountSecurityEvent
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Kind = AccountSecurityEvent.SecureAccount,
                    OccurredAt = now,
                    ClientAddressHash = AuditHash.Of(AuditHash.ClientAddress, clientAddress, key),
                    OldEmailHash = restored ? AuditHash.Of(AuditHash.Email, before?.ToUpperInvariant(), key) : null,
                    NewEmailHash = restored ? AuditHash.Of(AuditHash.Email, user.Email?.ToUpperInvariant(), key) : null,
                });
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                }

                return Step.Done(new SecureAccountResult(true, restored));
            }
            catch (DbUpdateConcurrencyException)
            {
                // Another call used the token, or the account changed. The next try tells which.
                await RollbackAsync(transaction).ConfigureAwait(false);
                return Step.Again(dropRestore: false);
            }
            catch (DbUpdateException) when (allowRestore)
            {
                // The unique index on the user name caught a race for the old address.
                await RollbackAsync(transaction).ConfigureAwait(false);
                return Step.Again(dropRestore: true);
            }
            catch
            {
                await RollbackAsync(transaction).ConfigureAwait(false);
                throw;
            }
        }
    }

    /// <summary>
    /// Puts the old address back when the change is inside its window and no other account holds
    /// the address. It runs in the caller's transaction, so the check and the write commit together.
    /// </summary>
    private async Task<RestoreOutcome> TryRestoreEmailAsync(
        ApplicationUser user,
        DateTime noticeCreatedAt,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // The notice is written after its change, so the change it reports is the latest one before it.
        var restore = await db.EmailChangeRestores
            .Where(r => r.UserId == user.Id && r.ConsumedAt == null && r.RestoreUntil > now && r.ChangedAt <= noticeCreatedAt)
            .OrderByDescending(r => r.ChangedAt)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        if (restore is null)
        {
            return RestoreOutcome.None;
        }

        var normalizedEmail = users.NormalizeEmail(restore.OldEmail);
        var normalizedName = users.NormalizeName(restore.OldEmail);
        var taken = await db.Users
            .AnyAsync(u => u.Id != user.Id && (u.NormalizedEmail == normalizedEmail || u.NormalizedUserName == normalizedName), cancellationToken)
            .ConfigureAwait(false);
        if (taken)
        {
            return RestoreOutcome.None;
        }

        var steps = new[]
        {
            await users.SetEmailAsync(user, restore.OldEmail).ConfigureAwait(false),
            await users.SetUserNameAsync(user, restore.OldEmail).ConfigureAwait(false),
        };
        if (steps.Any(s => !s.Succeeded))
        {
            return RestoreOutcome.Refused;
        }

        // The old address was confirmed before the change.
        user.EmailConfirmed = true;
        restore.ConsumedAt = now;
        return RestoreOutcome.Restored;
    }

    private sealed record Step(SecureAccountResult? Result, bool DropRestore)
    {
        internal static Step Done(SecureAccountResult result) => new(result, false);

        internal static Step Again(bool dropRestore) => new(null, dropRestore);
    }
}
