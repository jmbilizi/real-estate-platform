// <copyright file="PasswordChangeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Changes the password of a signed-in account (#661). It replaces the framework's
/// <c>POST /manage/info</c> password branch, which does not count a wrong current password toward the
/// lockout and does not write a security event.
/// </summary>
/// <remarks>
/// The current password is required and counts toward the same lock as a wrong password at sign-in.
/// The password validators run, so the policy and the breached-password check apply exactly as
/// they do at sign-up and reset. The new hash, the new security stamp and the
/// <see cref="AccountSecurityEvent"/> row commit together. The stamp ends every other session.
/// The notice goes to the account's address after the commit.
/// </remarks>
/// <param name="db">The account database.</param>
/// <param name="codeOptions">The code policy, for the audit key and the lock duration.</param>
/// <param name="users">The user manager.</param>
/// <param name="notices">The security notice sender.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class PasswordChangeService(
    AccountDbContext db,
    IOptions<EmailCodeOptions> codeOptions,
    AppUserManager users,
    SecurityNoticeService notices,
    TimeProvider timeProvider)
{
    /// <summary>Changes the password.</summary>
    /// <param name="userId">The signed-in account.</param>
    /// <param name="currentPassword">The current password.</param>
    /// <param name="newPassword">The new password.</param>
    /// <param name="clientAddress">The caller's address, for the audit hash.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<PasswordChangeResult> ChangeAsync(
        string userId,
        string? currentPassword,
        string? newPassword,
        string? clientAddress,
        CancellationToken cancellationToken = default)
    {
        var user = await users.FindByIdAsync(userId).ConfigureAwait(false);
        if (user is null || user.DeletedAt is not null || user.Email is null)
        {
            return new PasswordChangeResult(PasswordChangeStatus.NoAccount);
        }

        if (string.IsNullOrEmpty(currentPassword))
        {
            return new PasswordChangeResult(PasswordChangeStatus.CurrentRequired);
        }

        if (await users.IsLockedOutAsync(user).ConfigureAwait(false))
        {
            var end = await users.GetLockoutEndDateAsync(user).ConfigureAwait(false);
            var wait = end is { } until ? until - timeProvider.GetUtcNow() : codeOptions.Value.LockDuration;
            return new PasswordChangeResult(PasswordChangeStatus.Limited, RetryAfterSeconds: EmailCodeService.CeilSeconds(wait));
        }

        if (!await users.HasPasswordAsync(user).ConfigureAwait(false)
            || !await users.CheckPasswordAsync(user, currentPassword).ConfigureAwait(false))
        {
            await users.AccessFailedAsync(user).ConfigureAwait(false);
            return new PasswordChangeResult(PasswordChangeStatus.CurrentWrong);
        }

        // The validators run outside the transaction, so the breach check holds no connection.
        var errors = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var validator in users.PasswordValidators)
        {
            var checkedPassword = await validator.ValidateAsync(users, user, newPassword ?? string.Empty).ConfigureAwait(false);
            foreach (var error in checkedPassword.Errors)
            {
                errors[error.Code] = error.Description;
            }
        }

        if (errors.Count > 0)
        {
            return new PasswordChangeResult(PasswordChangeStatus.PasswordRejected, errors);
        }

        user.PasswordHash = users.PasswordHasher.HashPassword(user, newPassword!);

        var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false)
            : null;
        await using (transaction)
        {
            try
            {
                // Saves the hash with the new stamp. The stamp ends every cookie and bearer session.
                var updated = await users.UpdateSecurityStampAsync(user).ConfigureAwait(false);
                if (!updated.Succeeded)
                {
                    throw new InvalidOperationException(
                        "The password was not saved: " + string.Join(", ", updated.Errors.Select(e => e.Code)));
                }

                await users.ResetAccessFailedCountAsync(user).ConfigureAwait(false);

                db.AccountSecurityEvents.Add(new AccountSecurityEvent
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Kind = AccountSecurityEvent.PasswordChanged,
                    OccurredAt = timeProvider.GetUtcNow().UtcDateTime,
                    ClientAddressHash = AuditHash.Of(AuditHash.ClientAddress, clientAddress, codeOptions.Value.HmacKey),
                });
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                }
            }
            catch
            {
                if (transaction is not null)
                {
                    await transaction.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
                }

                db.ChangeTracker.Clear();
                throw;
            }
        }

        await notices.NotifyPasswordChangedAsync(user.Id, user.Email, AccountSecurityEvent.PasswordChanged).ConfigureAwait(false);
        return new PasswordChangeResult(PasswordChangeStatus.Changed, User: user);
    }
}
