// <copyright file="PasswordResetService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Password reset by emailed code (#658): start, verify and complete.
/// </summary>
/// <remarks>
/// <para>
/// Start and verify answer the same for an address with a usable account and for any other
/// address. A usable account is confirmed and not soft-deleted. Start sends a code only to a usable
/// account. For any other address verify counts the wrong tries in the rate limiter, so the tries
/// left and the lock match an address with a code. The decoy and send counters use their own scope,
/// so a reset never spends a sign-up counter.
/// </para>
/// <para>
/// A right code earns a single-use proof that lives 15 minutes. Complete uses the proof up first,
/// so a caller without a proof learns nothing about the password policy. The proof comes back when
/// the password is refused or an error stops the change. On success the new hash, the new security
/// stamp, the cleared lockout and the <see cref="AccountSecurityEvent"/> row commit together. The
/// new stamp ends every cookie and bearer session of the account (#142, #152).
/// </para>
/// <para>Nothing here logs the email, the code, the password or the proof.</para>
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="codes">The email code engine.</param>
/// <param name="codeOptions">The engine options.</param>
/// <param name="limiter">The rate limiter.</param>
/// <param name="users">The user manager.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class PasswordResetService(
    AccountDbContext db,
    EmailCodeService codes,
    IOptions<EmailCodeOptions> codeOptions,
    AccountRecoveryRateLimiter limiter,
    AppUserManager users,
    TimeProvider timeProvider)
{
    /// <summary>How long a reset proof works.</summary>
    internal static readonly TimeSpan ProofLifetime = TimeSpan.FromMinutes(15);

    private const int ProofBytes = 32;
    private const int PurgeBatchSize = 500;
    private const int MaxAttempts = 3;

    /// <summary>Sends a reset code to a usable account. Other addresses get the same answer.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SignUpResult> StartAsync(string? email, CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new SignUpResult(SignUpStatus.InvalidEmail);
        }

        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new SignUpResult(SignUpStatus.Unavailable);
        }

        if (limiter.IsDecoyLocked(key, out var lockedFor, AccountRecoveryRateLimiter.PasswordResetScope))
        {
            return new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: EmailCodeService.CeilSeconds(lockedFor));
        }

        var user = await this.FindUsableAsync(entered).ConfigureAwait(false);
        if (user is null)
        {
            return this.Accepted();
        }

        var issued = await codes.IssueAsync(user.Email ?? entered, EmailCodePurpose.PasswordReset, user.Id, cancellationToken)
            .ConfigureAwait(false);
        return issued.Status switch
        {
            EmailCodeIssueStatus.Issued => this.Accepted(),
            EmailCodeIssueStatus.Unavailable => new SignUpResult(SignUpStatus.Unavailable),
            _ => new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: issued.RetryAfterSeconds),
        };
    }

    /// <summary>Checks a code. A right code returns the one-time proof.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="code">The submitted code.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SignUpResult> VerifyAsync(string? email, string? code, CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new SignUpResult(SignUpStatus.InvalidEmail);
        }

        if (!codeOptions.Value.IsConfigured)
        {
            return new SignUpResult(SignUpStatus.Unavailable);
        }

        var user = await this.FindUsableAsync(entered).ConfigureAwait(false);
        if (user is not null)
        {
            var result = await codes.VerifyAsync(user.Email ?? entered, EmailCodePurpose.PasswordReset, code, cancellationToken)
                .ConfigureAwait(false);
            switch (result.Status)
            {
                case EmailCodeVerifyStatus.Verified:
                    return await this.IssueProofAsync(key, user.Id, cancellationToken).ConfigureAwait(false);
                case EmailCodeVerifyStatus.Locked:
                    return new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: result.RetryAfterSeconds);
                case EmailCodeVerifyStatus.Unavailable:
                    return new SignUpResult(SignUpStatus.Unavailable);
                default:
                    if (result.AttemptsLeft is int left)
                    {
                        return new SignUpResult(SignUpStatus.WrongCode, AttemptsLeft: left);
                    }

                    break;
            }
        }

        // No usable account, or no open code: the engine counted nothing. Count here, so the answer
        // matches an address with an open code.
        return this.WrongOrLocked(key);
    }

    /// <summary>Uses up the proof, sets the new password and ends every session of the account.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="proof">The submitted proof.</param>
    /// <param name="newPassword">The new password, as typed.</param>
    /// <param name="clientAddress">The client address, or null when unknown. The audit row holds a hash.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<PasswordResetCompleteResult> CompleteAsync(
        string? email,
        string? proof,
        string? newPassword,
        string? clientAddress,
        CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered)
            || await this.TryConsumeProofAsync(key, proof, cancellationToken).ConfigureAwait(false) is not { } userId)
        {
            return new PasswordResetCompleteResult(PasswordResetCompleteStatus.InvalidProof);
        }

        PasswordResetCompleteResult result;
        try
        {
            result = await this.ResetAsync(entered, userId, newPassword ?? string.Empty, clientAddress, cancellationToken)
                .ConfigureAwait(false);
        }
        catch
        {
            // The password did not change. The user keeps the proof and tries again.
            await this.ReleaseProofAsync(key, proof).ConfigureAwait(false);
            throw;
        }

        if (result.Status == PasswordResetCompleteStatus.PasswordRejected)
        {
            await this.ReleaseProofAsync(key, proof).ConfigureAwait(false);
        }
        else if (result.Status == PasswordResetCompleteStatus.Done)
        {
            await this.VoidOpenCodesAsync(entered).ConfigureAwait(false);
        }

        return result;
    }

    /// <summary>Deletes proofs past their expiry.</summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows deleted.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var now = this.Now();
        var total = 0;
        while (true)
        {
            var batch = await db.PasswordResetProofs
                .Where(p => p.ExpiresAt <= now)
                .Take(PurgeBatchSize)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            if (batch.Count == 0)
            {
                return total;
            }

            db.PasswordResetProofs.RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            total += batch.Count;
            if (batch.Count < PurgeBatchSize)
            {
                return total;
            }
        }
    }

    private static byte[] HashProof(string proof) => SHA256.HashData(Encoding.UTF8.GetBytes(proof));

    private DateTime Now() => timeProvider.GetUtcNow().UtcDateTime;

    private SignUpResult Accepted() => new(
        SignUpStatus.Ok,
        ResendAfterSeconds: (int)Math.Ceiling(codeOptions.Value.ResendCooldown.TotalSeconds),
        ExpiresInSeconds: EmailCodeService.CeilSeconds(codeOptions.Value.Lifetime));

    private SignUpResult WrongOrLocked(string key)
    {
        var settings = codeOptions.Value;
        return limiter.TryDecoyWrongTry(
            key,
            settings.MaxWrongTries,
            settings.LockDuration,
            settings.FailureWindow,
            out var attemptsLeft,
            out var retryAfter,
            AccountRecoveryRateLimiter.PasswordResetScope)
            ? new SignUpResult(SignUpStatus.WrongCode, AttemptsLeft: attemptsLeft)
            : new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: EmailCodeService.CeilSeconds(retryAfter));
    }

    /// <summary>
    /// Finds the account that may reset a password: confirmed and not soft-deleted.
    /// <see cref="AppUserManager.IsEmailConfirmedAsync"/> reports a soft-deleted account as unconfirmed.
    /// </summary>
    private async Task<ApplicationUser?> FindUsableAsync(string entered)
    {
        var user = await users.FindByEmailAsync(entered).ConfigureAwait(false);
        return user is not null && await users.IsEmailConfirmedAsync(user).ConfigureAwait(false) ? user : null;
    }

    private async Task<SignUpResult> IssueProofAsync(string key, string userId, CancellationToken cancellationToken)
    {
        var proof = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(ProofBytes));
        var hash = HashProof(proof);
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var now = this.Now();
            var row = await db.PasswordResetProofs
                .FirstOrDefaultAsync(p => p.Email == key, cancellationToken)
                .ConfigureAwait(false);
            if (row is null)
            {
                row = new PasswordResetProof { Id = Guid.NewGuid(), Email = key };
                db.PasswordResetProofs.Add(row);
            }

            row.UserId = userId;
            row.ProofHash = hash;
            row.CreatedAt = now;
            row.ExpiresAt = now + ProofLifetime;
            row.ConsumedAt = null;
            row.Version++;
            try
            {
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return new SignUpResult(
                    SignUpStatus.Verified,
                    ExpiresInSeconds: EmailCodeService.CeilSeconds(ProofLifetime),
                    Proof: proof);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
            }
        }

        // The code is already used up. With no stored proof the user must start again.
        return new SignUpResult(SignUpStatus.Unavailable);
    }

    /// <summary>Marks the proof used. Returns the account id once per proof, or null.</summary>
    private async Task<string?> TryConsumeProofAsync(string key, string? proof, CancellationToken cancellationToken)
    {
        var now = this.Now();
        var row = await db.PasswordResetProofs
            .FirstOrDefaultAsync(p => p.Email == key, cancellationToken)
            .ConfigureAwait(false);

        // Always hash and compare, so a missing row costs the same as a wrong proof.
        var matches = CryptographicOperations.FixedTimeEquals(
            HashProof(proof ?? string.Empty),
            row?.ProofHash ?? new byte[SHA256.HashSizeInBytes]);
        if (row is null || !matches || row.ConsumedAt is not null || row.ExpiresAt <= now)
        {
            return null;
        }

        row.ConsumedAt = now;
        row.Version++;
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return row.UserId;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another call used the proof first. Any other database fault surfaces as an error.
            db.ChangeTracker.Clear();
            return null;
        }
    }

    /// <summary>Gives a used proof back, after the password did not change. The proof keeps its expiry.</summary>
    private async Task ReleaseProofAsync(string key, string? proof)
    {
        if (string.IsNullOrEmpty(proof))
        {
            return;
        }

        db.ChangeTracker.Clear();
        var row = await db.PasswordResetProofs
            .FirstOrDefaultAsync(p => p.Email == key && p.ConsumedAt != null, CancellationToken.None)
            .ConfigureAwait(false);
        if (row is null || !CryptographicOperations.FixedTimeEquals(HashProof(proof), row.ProofHash))
        {
            return;
        }

        row.ConsumedAt = null;
        row.Version++;
        try
        {
            await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // The purge removed the row. The user starts again.
            db.ChangeTracker.Clear();
        }
    }

    private async Task<PasswordResetCompleteResult> ResetAsync(
        string entered,
        string userId,
        string password,
        string? clientAddress,
        CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(userId).ConfigureAwait(false);
        if (user is null
            || !string.Equals(user.Email?.Trim(), entered, StringComparison.OrdinalIgnoreCase)
            || !await users.IsEmailConfirmedAsync(user).ConfigureAwait(false))
        {
            return new PasswordResetCompleteResult(PasswordResetCompleteStatus.InvalidProof);
        }

        // The validators run outside the transaction, so the breach check holds no connection.
        var errors = new List<string>();
        foreach (var validator in users.PasswordValidators)
        {
            var checkedPassword = await validator.ValidateAsync(users, user, password).ConfigureAwait(false);
            errors.AddRange(checkedPassword.Errors.Select(e => e.Code));
        }

        if (errors.Count > 0)
        {
            return new PasswordResetCompleteResult(PasswordResetCompleteStatus.PasswordRejected, errors.Distinct().ToArray());
        }

        user.PasswordHash = users.PasswordHasher.HashPassword(user, password);

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

                await users.ClearLockoutAsync(user).ConfigureAwait(false);

                db.AccountSecurityEvents.Add(new AccountSecurityEvent
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    Kind = AccountSecurityEvent.PasswordReset,
                    OccurredAt = this.Now(),
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

        return new PasswordResetCompleteResult(PasswordResetCompleteStatus.Done);
    }

    /// <summary>
    /// Voids a code the user did not use. It runs after the commit and outside the proof release, so
    /// a failure here can neither undo a finished reset nor give the used proof back.
    /// </summary>
    private async Task VoidOpenCodesAsync(string entered)
    {
        try
        {
            await codes.InvalidateAsync(entered, EmailCodePurpose.PasswordReset, CancellationToken.None).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // The reset is done. An open code only earns a new proof, and it expires on its own.
            db.ChangeTracker.Clear();
        }
    }
}
