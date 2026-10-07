// <copyright file="EmailChangeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Changes the email of a signed-in account (#660): step-up, a code to the new address, then one
/// atomic swap.
/// </summary>
/// <remarks>
/// <para>
/// Start needs step-up first: the current password, or a code sent to the old address. A wrong
/// password counts toward the Identity lockout. A wrong code counts in the code engine.
/// </para>
/// <para>
/// Start answers the same for a taken and for a free new address. It stores a pending change in
/// both cases and sends the code only to a free address. For a taken address verify counts wrong
/// tries in the rate limiter, so the tries left and the lock match a free address.
/// </para>
/// <para>
/// A right code starts the swap. The swap checks the address again inside one transaction and
/// relies on the unique index over the normalized user name as the last guard. In one commit it
/// sets the email and the user name, keeps the email confirmed, rotates the security stamp, and
/// writes the <see cref="AccountSecurityEvent"/> and the <see cref="EmailChangeRestore"/> rows. The
/// new stamp ends every other session. The route issues a new session for the caller.
/// </para>
/// <para>Nothing here logs an email, a code or a password.</para>
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="codes">The email code engine.</param>
/// <param name="codeOptions">The engine options.</param>
/// <param name="limiter">The rate limiter.</param>
/// <param name="users">The user manager.</param>
/// <param name="timeProvider">The clock.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class EmailChangeService(
    AccountDbContext db,
    EmailCodeService codes,
    IOptions<EmailCodeOptions> codeOptions,
    AccountRecoveryRateLimiter limiter,
    AppUserManager users,
    TimeProvider timeProvider,
    ILogger<EmailChangeService> logger)
{
    /// <summary>How long a pending change lives.</summary>
    internal static readonly TimeSpan PendingLifetime = TimeSpan.FromMinutes(30);

    /// <summary>How long the "this wasn't me" restore window lasts (#662).</summary>
    internal static readonly TimeSpan RestoreWindow = TimeSpan.FromDays(7);

    private const int MaxAttempts = 3;
    private const int PurgeBatchSize = 500;

    /// <summary>Checks step-up, stores the pending change and sends the code to the new address.</summary>
    /// <param name="userId">The id of the signed-in account.</param>
    /// <param name="newEmail">The submitted new address.</param>
    /// <param name="currentPassword">The current password, or null.</param>
    /// <param name="oldEmailCode">The code sent to the old address, or null.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<EmailChangeResult> StartAsync(
        string userId,
        string? newEmail,
        string? currentPassword,
        string? oldEmailCode,
        CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(newEmail, out _, out var entered) || !this.NameAllowed(entered))
        {
            return new EmailChangeResult(EmailChangeStatus.InvalidEmail);
        }

        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new EmailChangeResult(EmailChangeStatus.Unavailable);
        }

        var user = await this.FindLiveAsync(userId).ConfigureAwait(false);
        if (user?.Email is null)
        {
            return new EmailChangeResult(EmailChangeStatus.NoAccount);
        }

        var stepUp = await this.StepUpAsync(user, currentPassword, oldEmailCode, cancellationToken).ConfigureAwait(false);
        if (stepUp is not null)
        {
            return stepUp;
        }

        var normalizedEmail = users.NormalizeEmail(entered);
        var normalizedName = users.NormalizeName(entered);
        var taken = string.Equals(user.NormalizedEmail, normalizedEmail, StringComparison.Ordinal)
            || await this.IsTakenAsync(user.Id, normalizedEmail, normalizedName, cancellationToken).ConfigureAwait(false);

        var previous = await this.StorePendingAsync(user.Id, entered, cancellationToken).ConfigureAwait(false);
        if (previous.Failed)
        {
            return new EmailChangeResult(EmailChangeStatus.Unavailable);
        }

        if (previous.Address is not null
            && !string.Equals(previous.Address, entered, StringComparison.OrdinalIgnoreCase))
        {
            await codes.InvalidateAsync(previous.Address, EmailCodePurpose.EmailChangeNew, cancellationToken).ConfigureAwait(false);
        }

        if (taken)
        {
            return this.Accepted(EmailChangeStatus.Accepted);
        }

        var issued = await codes.IssueAsync(entered, EmailCodePurpose.EmailChangeNew, user.Id, cancellationToken).ConfigureAwait(false);
        return issued.Status switch
        {
            EmailCodeIssueStatus.Issued => this.Accepted(EmailChangeStatus.Accepted),
            EmailCodeIssueStatus.Unavailable => new EmailChangeResult(EmailChangeStatus.Unavailable),

            // A cooldown or a lock answers as an accepted start, as for a taken address.
            _ => this.Accepted(EmailChangeStatus.Accepted) with { ResendAfterSeconds = issued.RetryAfterSeconds },
        };
    }

    /// <summary>Checks the code from the new address and swaps the email.</summary>
    /// <param name="userId">The id of the signed-in account.</param>
    /// <param name="code">The submitted code.</param>
    /// <param name="clientAddress">The client address, or null when unknown. The audit row holds a hash.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result. <see cref="EmailChangeStatus.Changed"/> carries the changed account.</returns>
    internal async Task<EmailChangeResult> VerifyAsync(
        string userId,
        string? code,
        string? clientAddress,
        CancellationToken cancellationToken = default)
    {
        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new EmailChangeResult(EmailChangeStatus.Unavailable);
        }

        var user = await this.FindLiveAsync(userId).ConfigureAwait(false);
        if (user is null)
        {
            return new EmailChangeResult(EmailChangeStatus.NoAccount);
        }

        var pending = await db.PendingEmailChanges
            .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken)
            .ConfigureAwait(false);
        var live = pending is not null && pending.ExpiresAt > this.Now();

        // No pending change, an expired one, a taken address and a code never sent all count in
        // the limiter. The key is the new address when there is one, so they all look alike.
        var decoyKey = live ? pending!.NewEmail.Trim().ToUpperInvariant() : "USER:" + userId;
        if (live)
        {
            var result = await codes.VerifyAsync(pending!.NewEmail, EmailCodePurpose.EmailChangeNew, code, cancellationToken)
                .ConfigureAwait(false);
            switch (result.Status)
            {
                case EmailCodeVerifyStatus.Verified:
                    return await this.SwapAsync(user, pending, clientAddress, cancellationToken).ConfigureAwait(false);
                case EmailCodeVerifyStatus.Locked:
                    return new EmailChangeResult(EmailChangeStatus.Limited, RetryAfterSeconds: result.RetryAfterSeconds);
                case EmailCodeVerifyStatus.Unavailable:
                    return new EmailChangeResult(EmailChangeStatus.Unavailable);
                default:
                    if (result.AttemptsLeft is int left)
                    {
                        return new EmailChangeResult(EmailChangeStatus.WrongCode, AttemptsLeft: left);
                    }

                    break;
            }
        }

        return limiter.TryDecoyWrongTry(
            decoyKey,
            settings.MaxWrongTries,
            settings.LockDuration,
            settings.FailureWindow,
            out var attemptsLeft,
            out var retryAfter,
            AccountRecoveryRateLimiter.EmailChangeScope)
            ? new EmailChangeResult(EmailChangeStatus.WrongCode, AttemptsLeft: attemptsLeft)
            : new EmailChangeResult(EmailChangeStatus.Limited, RetryAfterSeconds: EmailCodeService.CeilSeconds(retryAfter));
    }

    /// <summary>Deletes pending changes past their expiry and restore rows past their window.</summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows deleted.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var now = this.Now();
        var pending = await this.PurgeBatchesAsync(db.PendingEmailChanges.Where(p => p.ExpiresAt <= now), db.PendingEmailChanges, cancellationToken)
            .ConfigureAwait(false);
        var restores = await this.PurgeBatchesAsync(db.EmailChangeRestores.Where(r => r.RestoreUntil <= now), db.EmailChangeRestores, cancellationToken)
            .ConfigureAwait(false);
        return pending + restores;
    }

    [LoggerMessage(1390, LogLevel.Warning, "The email change was refused by Identity: {Errors}.", EventName = "EmailChangeRefused")]
    private static partial void LogRefused(ILogger logger, string errors);

    private async Task<int> PurgeBatchesAsync<T>(IQueryable<T> expired, DbSet<T> set, CancellationToken cancellationToken)
        where T : class
    {
        var total = 0;
        while (true)
        {
            var batch = await expired.Take(PurgeBatchSize).ToListAsync(cancellationToken).ConfigureAwait(false);
            if (batch.Count == 0)
            {
                return total;
            }

            set.RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            total += batch.Count;
            if (batch.Count < PurgeBatchSize)
            {
                return total;
            }
        }
    }

    private DateTime Now() => timeProvider.GetUtcNow().UtcDateTime;

    private EmailChangeResult Accepted(EmailChangeStatus status) => new(
        status,
        ResendAfterSeconds: (int)Math.Ceiling(codeOptions.Value.ResendCooldown.TotalSeconds),
        ExpiresInSeconds: EmailCodeService.CeilSeconds(codeOptions.Value.Lifetime));

    /// <summary>
    /// The account name is the email. Identity refuses a name with a character outside its allowed
    /// set. Checking at start spares the user a code that cannot finish.
    /// </summary>
    private bool NameAllowed(string entered)
    {
        var allowed = users.Options.User.AllowedUserNameCharacters;
        return string.IsNullOrEmpty(allowed) || entered.All(allowed.Contains);
    }

    private async Task<ApplicationUser?> FindLiveAsync(string userId)
    {
        var user = await users.FindByIdAsync(userId).ConfigureAwait(false);
        return user is { DeletedAt: null } ? user : null;
    }

    private Task<bool> IsTakenAsync(string userId, string? normalizedEmail, string? normalizedName, CancellationToken cancellationToken) =>
        db.Users.AnyAsync(
            u => u.Id != userId && (u.NormalizedEmail == normalizedEmail || u.NormalizedUserName == normalizedName),
            cancellationToken);

    /// <summary>
    /// Runs step-up. Returns null when it passed, else the result to answer with. With no
    /// password and no code it sends a code to the old address.
    /// </summary>
    private async Task<EmailChangeResult?> StepUpAsync(
        ApplicationUser user,
        string? currentPassword,
        string? oldEmailCode,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(currentPassword))
        {
            if (await users.IsLockedOutAsync(user).ConfigureAwait(false))
            {
                var end = await users.GetLockoutEndDateAsync(user).ConfigureAwait(false);
                var wait = end is { } until ? until - timeProvider.GetUtcNow() : codeOptions.Value.LockDuration;
                return new EmailChangeResult(EmailChangeStatus.Limited, RetryAfterSeconds: EmailCodeService.CeilSeconds(wait));
            }

            if (!await users.HasPasswordAsync(user).ConfigureAwait(false)
                || !await users.CheckPasswordAsync(user, currentPassword).ConfigureAwait(false))
            {
                // Counts toward the same lock as a wrong password at sign-in.
                await users.AccessFailedAsync(user).ConfigureAwait(false);
                return new EmailChangeResult(EmailChangeStatus.StepUpFailed);
            }

            await users.ResetAccessFailedCountAsync(user).ConfigureAwait(false);
            return null;
        }

        if (!string.IsNullOrWhiteSpace(oldEmailCode))
        {
            var result = await codes.VerifyAsync(user.Email!, EmailCodePurpose.EmailChangeOld, oldEmailCode, cancellationToken)
                .ConfigureAwait(false);
            return result.Status switch
            {
                EmailCodeVerifyStatus.Verified => null,
                EmailCodeVerifyStatus.Locked => new EmailChangeResult(EmailChangeStatus.Limited, RetryAfterSeconds: result.RetryAfterSeconds),
                EmailCodeVerifyStatus.Unavailable => new EmailChangeResult(EmailChangeStatus.Unavailable),
                _ => new EmailChangeResult(EmailChangeStatus.StepUpFailed, AttemptsLeft: result.AttemptsLeft),
            };
        }

        var issued = await codes.IssueAsync(user.Email!, EmailCodePurpose.EmailChangeOld, user.Id, cancellationToken)
            .ConfigureAwait(false);
        return issued.Status switch
        {
            EmailCodeIssueStatus.Issued => this.Accepted(EmailChangeStatus.StepUpRequired),
            EmailCodeIssueStatus.Unavailable => new EmailChangeResult(EmailChangeStatus.Unavailable),
            _ => new EmailChangeResult(EmailChangeStatus.Limited, RetryAfterSeconds: issued.RetryAfterSeconds),
        };
    }

    private async Task<(bool Failed, string? Address)> StorePendingAsync(string userId, string entered, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var now = this.Now();
            var row = await db.PendingEmailChanges
                .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken)
                .ConfigureAwait(false);
            var previous = row?.NewEmail;
            if (row is null)
            {
                row = new PendingEmailChange { Id = Guid.NewGuid(), UserId = userId };
                db.PendingEmailChanges.Add(row);
            }

            row.NewEmail = entered;
            row.CreatedAt = now;
            row.ExpiresAt = now + PendingLifetime;
            row.Version++;
            try
            {
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return (false, previous);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
            }
        }

        return (true, null);
    }

    private async Task<EmailChangeResult> SwapAsync(
        ApplicationUser user,
        PendingEmailChange pending,
        string? clientAddress,
        CancellationToken cancellationToken)
    {
        var entered = pending.NewEmail;
        var oldEmail = user.Email!;
        var now = this.Now();

        var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false)
            : null;
        await using (transaction)
        {
            try
            {
                // The change is spent whatever happens next. A second call finds nothing.
                db.PendingEmailChanges.Remove(pending);

                var normalizedEmail = users.NormalizeEmail(entered);
                var normalizedName = users.NormalizeName(entered);
                if (await this.IsTakenAsync(user.Id, normalizedEmail, normalizedName, cancellationToken).ConfigureAwait(false))
                {
                    return await this.AbandonAsync(transaction).ConfigureAwait(false);
                }

                var steps = new[]
                {
                    await users.SetEmailAsync(user, entered).ConfigureAwait(false),
                    await users.SetUserNameAsync(user, entered).ConfigureAwait(false),
                };
                var refused = steps.FirstOrDefault(s => !s.Succeeded);
                if (refused is not null)
                {
                    LogRefused(logger, string.Join(", ", refused.Errors.Select(e => e.Code)));
                    return await this.AbandonAsync(transaction).ConfigureAwait(false);
                }

                // The address is proved by the code. Saves with the new stamp, which ends every session.
                user.EmailConfirmed = true;
                user.UpdatedAt = now;
                var stamped = await users.UpdateSecurityStampAsync(user).ConfigureAwait(false);
                if (!stamped.Succeeded)
                {
                    LogRefused(logger, string.Join(", ", stamped.Errors.Select(e => e.Code)));
                    return await this.AbandonAsync(transaction).ConfigureAwait(false);
                }

                var key = codeOptions.Value.HmacKey;
                db.AccountSecurityEvents.Add(new AccountSecurityEvent
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Kind = AccountSecurityEvent.EmailChanged,
                    OccurredAt = now,
                    ClientAddressHash = AuditHash.Of(AuditHash.ClientAddress, clientAddress, key),
                    OldEmailHash = AuditHash.Of(AuditHash.Email, oldEmail.ToUpperInvariant(), key),
                    NewEmailHash = AuditHash.Of(AuditHash.Email, entered.ToUpperInvariant(), key),
                });
                db.EmailChangeRestores.Add(new EmailChangeRestore
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    OldEmail = oldEmail,
                    ChangedAt = now,
                    RestoreUntil = now + RestoreWindow,
                });
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                }
            }
            catch (DbUpdateException)
            {
                // The unique index on the user name caught a race, or another call spent the change.
                return await this.AbandonAsync(transaction).ConfigureAwait(false);
            }
            catch
            {
                await this.RollbackAsync(transaction).ConfigureAwait(false);
                throw;
            }
        }

        await this.VoidLeftoverCodesAsync(oldEmail, entered).ConfigureAwait(false);
        return new EmailChangeResult(EmailChangeStatus.Changed, User: user);
    }

    private async Task<EmailChangeResult> AbandonAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction)
    {
        await this.RollbackAsync(transaction).ConfigureAwait(false);
        return new EmailChangeResult(EmailChangeStatus.Failed);
    }

    private async Task RollbackAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction)
    {
        if (transaction is not null)
        {
            await transaction.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
        }

        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// Voids codes the swap did not use. It runs after the commit, so a failure here cannot undo
    /// the change. An open code only expires on its own.
    /// </summary>
    private async Task VoidLeftoverCodesAsync(string oldEmail, string newEmail)
    {
        try
        {
            await codes.InvalidateAsync(oldEmail, EmailCodePurpose.EmailChangeOld, CancellationToken.None).ConfigureAwait(false);
            await codes.InvalidateAsync(newEmail, EmailCodePurpose.EmailChangeNew, CancellationToken.None).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
        }
    }
}
