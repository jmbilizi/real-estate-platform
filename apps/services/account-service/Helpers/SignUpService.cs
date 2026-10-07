// <copyright file="SignUpService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Buffers.Text;
using System.Security.Cryptography;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The sign-up steps before an account exists: start, verify, resend and change email.
/// </summary>
/// <remarks>
/// <para>
/// No step creates or reads an <see cref="ApplicationUser"/> row apart from one existence check.
/// The row appears only when the user sets a password (#654), with the proof this service issues.
/// </para>
/// <para>
/// An address that already has an account gets the same answer as a new one, in status and body.
/// Start sends the already-registered notice instead of a code. Resend and verify do nothing for it.
/// The wrong tries of an address with no open code count in the rate limiter, so the answer shows
/// the same tries left and the same lock as an address with a code.
/// </para>
/// <para>
/// Nothing here logs the email, the code or the proof.
/// </para>
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="codes">The email code engine.</param>
/// <param name="codeOptions">The engine options.</param>
/// <param name="options">The sign-up options.</param>
/// <param name="limiter">The rate limiter.</param>
/// <param name="users">The user manager, for the existence check only.</param>
/// <param name="composer">The message composer.</param>
/// <param name="sender">The delivery seam.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class SignUpService(
    AccountDbContext db,
    EmailCodeService codes,
    IOptions<EmailCodeOptions> codeOptions,
    IOptions<SignUpOptions> options,
    AccountRecoveryRateLimiter limiter,
    UserManager<ApplicationUser> users,
    IdentityEmailComposer composer,
    IOutboundEmailSender sender,
    TimeProvider timeProvider)
{
    private const int ProofBytes = 32;
    private const int PurgeBatchSize = 500;

    /// <summary>Starts a sign-up, or sends the notice when the address has an account.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SignUpResult> StartAsync(string? email, CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new SignUpResult(SignUpStatus.InvalidEmail);
        }

        var gate = this.Gate(key);
        if (gate is not null)
        {
            return gate;
        }

        if (await users.FindByEmailAsync(entered).ConfigureAwait(false) is not null)
        {
            await sender.SendAsync(composer.AlreadyRegistered(entered), cancellationToken).ConfigureAwait(false);
            return this.Accepted();
        }

        var now = this.Now();
        var row = await db.PendingRegistrations
            .FirstOrDefaultAsync(p => p.Email == key, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            row = new PendingRegistration
            {
                Id = Guid.NewGuid(),
                Email = key,
                EmailAsEntered = entered,
                State = PendingRegistrationState.AwaitingCode,
                CreatedAt = now,
                UpdatedAt = now,
                ExpiresAt = now + options.Value.PendingLifetime,
            };
            db.PendingRegistrations.Add(row);
            try
            {
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                // A parallel start inserted the row first. Both carry the same address.
                db.ChangeTracker.Clear();
                row = await db.PendingRegistrations.FirstAsync(p => p.Email == key, cancellationToken).ConfigureAwait(false);
            }
        }

        return await this.IssueAsync(row, entered, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Sends a new code for an open pending sign-up. Other addresses get the same answer.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SignUpResult> ResendAsync(string? email, CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered))
        {
            return new SignUpResult(SignUpStatus.InvalidEmail);
        }

        var gate = this.Gate(key);
        if (gate is not null)
        {
            return gate;
        }

        var now = this.Now();
        var row = await db.PendingRegistrations
            .FirstOrDefaultAsync(
                p => p.Email == key && p.State == PendingRegistrationState.AwaitingCode && p.ExpiresAt > now,
                cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            return this.Accepted();
        }

        return await this.IssueAsync(row, row.EmailAsEntered.Length > 0 ? row.EmailAsEntered : entered, cancellationToken)
            .ConfigureAwait(false);
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

        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new SignUpResult(SignUpStatus.Unavailable);
        }

        var now = this.Now();
        var row = await db.PendingRegistrations
            .FirstOrDefaultAsync(
                p => p.Email == key && p.State == PendingRegistrationState.AwaitingCode && p.ExpiresAt > now,
                cancellationToken)
            .ConfigureAwait(false);

        if (row is not null)
        {
            var result = await codes.VerifyAsync(entered, EmailCodePurpose.SignUp, code, cancellationToken).ConfigureAwait(false);
            switch (result.Status)
            {
                case EmailCodeVerifyStatus.Verified:
                    var current = await db.PendingRegistrations
                        .FirstOrDefaultAsync(p => p.Email == key, cancellationToken)
                        .ConfigureAwait(false);
                    return current is null
                        ? this.WrongOrLocked(key)
                        : await this.IssueProofAsync(current, cancellationToken).ConfigureAwait(false);
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

        // No pending row, or no open code: the engine counted nothing. Count here, so the answer
        // matches an address with an open code.
        return this.WrongOrLocked(key);
    }

    /// <summary>Drops one pending sign-up and starts another for a new address.</summary>
    /// <param name="oldEmail">The address to drop.</param>
    /// <param name="newEmail">The address to sign up instead.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result.</returns>
    internal async Task<SignUpResult> ChangeEmailAsync(
        string? oldEmail,
        string? newEmail,
        CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(oldEmail, out var oldKey, out var oldEntered)
            || !SignUpEmail.TryNormalize(newEmail, out var newKey, out _))
        {
            return new SignUpResult(SignUpStatus.InvalidEmail);
        }

        var started = await this.StartAsync(newEmail, cancellationToken).ConfigureAwait(false);
        if (started.Status != SignUpStatus.Ok || oldKey == newKey)
        {
            return started;
        }

        await this.DropAsync(oldKey, oldEntered, cancellationToken).ConfigureAwait(false);
        return started;
    }

    /// <summary>
    /// Uses up a sign-up proof. #654 calls this before it creates the account.
    /// </summary>
    /// <param name="email">The address the proof is bound to.</param>
    /// <param name="proof">The proof the verify step returned.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns><see langword="true"/> once per proof, while it is live and matches the address.</returns>
    internal async Task<bool> TryConsumeProofAsync(string? email, string? proof, CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out _))
        {
            return false;
        }

        var now = this.Now();
        var row = await db.PendingRegistrations
            .FirstOrDefaultAsync(p => p.Email == key, cancellationToken)
            .ConfigureAwait(false);

        // Always hash and compare, so a missing row costs the same as a wrong proof.
        var submitted = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(proof ?? string.Empty));
        var matches = CryptographicOperations.FixedTimeEquals(submitted, row?.ProofHash ?? new byte[SHA256.HashSizeInBytes]);
        if (row is null
            || !matches
            || row.State != PendingRegistrationState.Verified
            || row.ProofConsumedAt is not null
            || row.ProofExpiresAt is null
            || row.ProofExpiresAt <= now)
        {
            return false;
        }

        row.ProofConsumedAt = now;
        row.UpdatedAt = now;
        row.Version++;
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (DbUpdateException)
        {
            // Another call used the proof first.
            db.ChangeTracker.Clear();
            return false;
        }
    }

    /// <summary>Deletes pending rows past their expiry.</summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows deleted.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var now = this.Now();
        var total = 0;
        while (true)
        {
            var batch = await db.PendingRegistrations
                .Where(p => p.ExpiresAt <= now)
                .Take(PurgeBatchSize)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            if (batch.Count == 0)
            {
                return total;
            }

            db.PendingRegistrations.RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            total += batch.Count;
        }
    }

    private static int CeilSeconds(TimeSpan span) => Math.Max(1, (int)Math.Ceiling(span.TotalSeconds));

    private SignUpResult WrongOrLocked(string key)
    {
        var settings = codeOptions.Value;
        return limiter.TryDecoyWrongTry(key, settings.MaxWrongTries, settings.LockDuration, out var attemptsLeft, out var retryAfter)
            ? new SignUpResult(SignUpStatus.WrongCode, AttemptsLeft: attemptsLeft)
            : new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: CeilSeconds(retryAfter));
    }

    private DateTime Now() => timeProvider.GetUtcNow().UtcDateTime;

    private SignUpResult Accepted() => new(
        SignUpStatus.Ok,
        ResendAfterSeconds: (int)Math.Ceiling(codeOptions.Value.ResendCooldown.TotalSeconds),
        ExpiresInSeconds: CeilSeconds(codeOptions.Value.Lifetime));

    /// <summary>
    /// The checks every send shares: the engine has a key, and the address is not locked. A lock
    /// for an address with no code lives in the limiter, so the check covers both cases.
    /// </summary>
    private SignUpResult? Gate(string key)
    {
        var settings = codeOptions.Value;
        if (!settings.IsConfigured)
        {
            return new SignUpResult(SignUpStatus.Unavailable);
        }

        if (limiter.IsDecoyLocked(key, settings.MaxWrongTries, out var retryAfter))
        {
            return new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: CeilSeconds(retryAfter));
        }

        return null;
    }

    private async Task<SignUpResult> IssueAsync(PendingRegistration row, string entered, CancellationToken cancellationToken)
    {
        var issued = await codes.IssueAsync(entered, EmailCodePurpose.SignUp, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        switch (issued.Status)
        {
            case EmailCodeIssueStatus.Issued:
                // The engine clears the change tracker when it retries a conflict, which detaches
                // the row. Load it again.
                var now = this.Now();
                var current = await db.PendingRegistrations
                    .FirstOrDefaultAsync(p => p.Email == row.Email, cancellationToken)
                    .ConfigureAwait(false);
                if (current is null)
                {
                    return this.Accepted();
                }

                row = current;
                row.State = PendingRegistrationState.AwaitingCode;
                row.ProofHash = null;
                row.ProofExpiresAt = null;
                row.ProofConsumedAt = null;
                row.UpdatedAt = now;
                row.ExpiresAt = now + options.Value.PendingLifetime;
                row.Version++;
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return this.Accepted();
            case EmailCodeIssueStatus.Unavailable:
                return new SignUpResult(SignUpStatus.Unavailable);
            default:
                return new SignUpResult(SignUpStatus.Limited, RetryAfterSeconds: issued.RetryAfterSeconds);
        }
    }

    private async Task<SignUpResult> IssueProofAsync(PendingRegistration row, CancellationToken cancellationToken)
    {
        var proof = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(ProofBytes));
        var now = this.Now();
        var life = options.Value.ProofLifetime;
        row.State = PendingRegistrationState.Verified;
        row.ProofHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(proof));
        row.ProofExpiresAt = now + life;
        row.ProofConsumedAt = null;
        row.UpdatedAt = now;

        // The row must outlive the proof, or the purge could delete it before #654 uses it.
        var proofEnd = now + life;
        if (row.ExpiresAt < proofEnd)
        {
            row.ExpiresAt = proofEnd;
        }

        row.Version++;
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return new SignUpResult(SignUpStatus.Verified, ExpiresInSeconds: CeilSeconds(life), Proof: proof);
    }

    private async Task DropAsync(string key, string entered, CancellationToken cancellationToken)
    {
        await codes.InvalidateAsync(entered, EmailCodePurpose.SignUp, cancellationToken).ConfigureAwait(false);
        var rows = await db.PendingRegistrations.Where(p => p.Email == key).ToListAsync(cancellationToken).ConfigureAwait(false);
        db.PendingRegistrations.RemoveRange(rows);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }
}
