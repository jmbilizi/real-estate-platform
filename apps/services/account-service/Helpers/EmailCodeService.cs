// <copyright file="EmailCodeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Issues, verifies and voids the short codes that prove a user controls a mailbox.
/// </summary>
/// <remarks>
/// <para>
/// A code is 6 digits, lives 10 minutes and works once. The service stores an HMAC of the code,
/// never the code, and compares in constant time. Wrong tries count per email and purpose, apart
/// from the codes, so a resend does not reset them. The resend caps count issued rows.
/// </para>
/// <para>
/// A row <c>Version</c> is an EF concurrency token. A striped in-process lock saves most
/// conflicts. The token catches the rest across replicas: the loser reloads and retries, so two
/// parallel wrong tries both count and one code verifies once.
/// </para>
/// <para>
/// A wrong try counts only while a code is open. With no open code nothing can verify, so the
/// call stores no row. A caller cannot grow the throttle table with random addresses.
/// </para>
/// <para>
/// Nothing here logs the email or the code.
/// </para>
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="options">The engine options.</param>
/// <param name="composer">The message composer.</param>
/// <param name="sender">The delivery seam.</param>
/// <param name="timeProvider">The clock.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class EmailCodeService(
    AccountDbContext db,
    IOptions<EmailCodeOptions> options,
    IdentityEmailComposer composer,
    IOutboundEmailSender sender,
    TimeProvider timeProvider,
    ILogger<EmailCodeService> logger)
{
    /// <summary>The longest address the engine accepts, per RFC 5321.</summary>
    internal const int MaxEmailLength = 320;

    private const int StripeCount = 64;
    private const int MaxAttempts = 5;
    private const int PurgeBatchSize = 500;

    private static readonly SemaphoreSlim[] Stripes =
        Enumerable.Range(0, StripeCount).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    private static readonly byte[] NoCodeHash = new byte[HMACSHA256.HashSizeInBytes];

    /// <summary>
    /// Voids every open code for the email and purpose, stores a new one and queues the message.
    /// </summary>
    /// <param name="email">The recipient. Compared case-insensitively. The caller validates it.</param>
    /// <param name="purpose">What the code proves.</param>
    /// <param name="userId">The account id the purpose needs, or null.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result. A limit is a result, never an exception.</returns>
    internal async Task<EmailCodeIssueResult> IssueAsync(
        string email,
        EmailCodePurpose purpose,
        string? userId = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(email.Trim().Length, MaxEmailLength);

        var settings = options.Value;
        if (!settings.IsConfigured)
        {
            LogUnavailable(logger);
            return new EmailCodeIssueResult(EmailCodeIssueStatus.Unavailable);
        }

        var key = Normalize(email);
        var gate = Stripes[StripeFor(key, purpose)];
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await this.RetryAsync(
                () => this.IssueOnceAsync(settings, email, key, purpose, userId, cancellationToken),
                new EmailCodeIssueResult(EmailCodeIssueStatus.Throttled, 1)).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Checks a submitted code and uses it up when it is right.</summary>
    /// <param name="email">The address the code was sent to.</param>
    /// <param name="purpose">What the code proves.</param>
    /// <param name="code">The submitted code.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The result. A wrong code counts toward the lock.</returns>
    internal async Task<EmailCodeVerifyResult> VerifyAsync(
        string email,
        EmailCodePurpose purpose,
        string? code,
        CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        if (!settings.IsConfigured)
        {
            LogUnavailable(logger);
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Unavailable);
        }

        if (string.IsNullOrWhiteSpace(email) || email.Trim().Length > MaxEmailLength)
        {
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Invalid);
        }

        var key = Normalize(email);
        var gate = Stripes[StripeFor(key, purpose)];
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await this.RetryAsync(
                () => this.VerifyOnceAsync(settings, key, purpose, code, cancellationToken),
                new EmailCodeVerifyResult(EmailCodeVerifyStatus.Invalid)).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Voids every open code for the email and purpose. It does not touch the wrong-try count.
    /// </summary>
    /// <param name="email">The address.</param>
    /// <param name="purpose">The purpose.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the codes are void.</returns>
    internal async Task InvalidateAsync(string email, EmailCodePurpose purpose, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);

        var key = Normalize(email);
        var gate = Stripes[StripeFor(key, purpose)];
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await this.RetryAsync(
                async () =>
                {
                    await this.VoidOpenAsync(key, purpose, this.Now(), cancellationToken).ConfigureAwait(false);
                    await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                    return true;
                },
                false).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Deletes consumed and expired codes older than the longest resend window, and stale
    /// wrong-try rows. A younger row stays because the resend caps count it.
    /// </summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows deleted.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        var now = this.Now();
        var keepAfter = now - TimeSpan.FromDays(1);
        var staleBefore = now - settings.FailureWindow;

        var codes = await this.DeleteInBatchesAsync(
            db.EmailCodes.Where(c => c.CreatedAt < keepAfter && (c.ConsumedAt != null || c.ExpiresAt <= now)),
            cancellationToken).ConfigureAwait(false);
        var throttles = await this.DeleteInBatchesAsync(
            db.EmailCodeThrottles.Where(t => t.UpdatedAt < staleBefore && (t.LockedUntil == null || t.LockedUntil <= now)),
            cancellationToken).ConfigureAwait(false);
        return codes + throttles;
    }

    [LoggerMessage(1380, LogLevel.Warning, "Email codes are unavailable: no usable EMAIL_CODE_HMAC_KEY is configured. The call was refused.", EventName = "EmailCodesUnavailable")]
    private static partial void LogUnavailable(ILogger logger);

    [LoggerMessage(1381, LogLevel.Information, "Email code lock engaged for purpose {Purpose}.", EventName = "EmailCodeLocked")]
    private static partial void LogLocked(ILogger logger, EmailCodePurpose purpose);

    private static string Normalize(string email) => email.Trim().ToUpperInvariant();

    private static int StripeFor(string key, EmailCodePurpose purpose) =>
        (int)((uint)HashCode.Combine(key, purpose) % StripeCount);

    private static string GenerateCode(int length) =>
        RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, length)).ToString("D" + length, CultureInfo.InvariantCulture);

    private static byte[] Hash(EmailCodeOptions settings, string key, EmailCodePurpose purpose, string code) =>
        HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(settings.HmacKey),
            Encoding.UTF8.GetBytes($"{purpose}:{key}:{code}"));

    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a > b ? a : b;

    private static int CeilSeconds(TimeSpan span) => Math.Max(1, (int)Math.Ceiling(span.TotalSeconds));

    private DateTime Now() => timeProvider.GetUtcNow().UtcDateTime;

    /// <summary>
    /// Runs one read-then-write step again when another writer changed a row first. The step
    /// rereads the rows, so it sees the other writer's result.
    /// </summary>
    private async Task<T> RetryAsync<T>(Func<Task<T>> step, T whenExhausted)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            try
            {
                return await step().ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
            }
        }

        return whenExhausted;
    }

    private async Task<EmailCodeIssueResult> IssueOnceAsync(
        EmailCodeOptions settings,
        string email,
        string key,
        EmailCodePurpose purpose,
        string? userId,
        CancellationToken cancellationToken)
    {
        var now = this.Now();

        var throttle = await db.EmailCodeThrottles
            .FirstOrDefaultAsync(t => t.Email == key && t.Purpose == purpose, cancellationToken)
            .ConfigureAwait(false);
        if (throttle?.LockedUntil > now)
        {
            return new EmailCodeIssueResult(EmailCodeIssueStatus.Locked, CeilSeconds(throttle.LockedUntil.Value - now));
        }

        var dayStart = now - TimeSpan.FromDays(1);
        var hourStart = now - TimeSpan.FromHours(1);
        var recent = await db.EmailCodes
            .Where(c => c.Email == key && c.Purpose == purpose && c.CreatedAt > dayStart)
            .OrderBy(c => c.CreatedAt)
            .Select(c => c.CreatedAt)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var wait = TimeSpan.Zero;
        if (recent.Count > 0)
        {
            wait = Max(wait, recent[^1] + settings.ResendCooldown - now);
        }

        var inHour = recent.Where(t => t > hourStart).ToList();
        if (inHour.Count >= settings.MaxPerHour)
        {
            wait = Max(wait, inHour[inHour.Count - settings.MaxPerHour] + TimeSpan.FromHours(1) - now);
        }

        if (recent.Count >= settings.MaxPerDay)
        {
            wait = Max(wait, recent[recent.Count - settings.MaxPerDay] + TimeSpan.FromDays(1) - now);
        }

        if (wait > TimeSpan.Zero)
        {
            return new EmailCodeIssueResult(EmailCodeIssueStatus.Throttled, CeilSeconds(wait));
        }

        await this.VoidOpenAsync(key, purpose, now, cancellationToken).ConfigureAwait(false);

        var code = GenerateCode(settings.CodeLength);
        db.EmailCodes.Add(new EmailCode
        {
            Id = Guid.NewGuid(),
            Email = key,
            Purpose = purpose,
            CodeHash = Hash(settings, key, purpose, code),
            CreatedAt = now,
            ExpiresAt = now + settings.Lifetime,
            UserId = userId,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        await sender.SendAsync(composer.Code(email.Trim(), code, settings.Lifetime), cancellationToken).ConfigureAwait(false);
        return new EmailCodeIssueResult(EmailCodeIssueStatus.Issued);
    }

    private async Task<EmailCodeVerifyResult> VerifyOnceAsync(
        EmailCodeOptions settings,
        string key,
        EmailCodePurpose purpose,
        string? code,
        CancellationToken cancellationToken)
    {
        var now = this.Now();

        var throttle = await db.EmailCodeThrottles
            .FirstOrDefaultAsync(t => t.Email == key && t.Purpose == purpose, cancellationToken)
            .ConfigureAwait(false);
        if (throttle?.LockedUntil > now)
        {
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Locked, CeilSeconds(throttle.LockedUntil.Value - now));
        }

        var open = await db.EmailCodes
            .Where(c => c.Email == key && c.Purpose == purpose && c.ConsumedAt == null && c.ExpiresAt > now)
            .OrderByDescending(c => c.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        // Always hash and compare, so a missing code costs the same as a wrong one.
        var submitted = Hash(settings, key, purpose, (code ?? string.Empty).Trim());
        var matches = CryptographicOperations.FixedTimeEquals(submitted, open?.CodeHash ?? NoCodeHash);

        if (open is null)
        {
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Invalid);
        }

        if (matches)
        {
            open.ConsumedAt = now;
            open.Version++;
            if (throttle is not null)
            {
                db.EmailCodeThrottles.Remove(throttle);
            }

            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Verified, UserId: open.UserId);
        }

        if (throttle is null)
        {
            throttle = new EmailCodeThrottle { Email = key, Purpose = purpose };
            db.EmailCodeThrottles.Add(throttle);
        }
        else
        {
            throttle.Version++;
            if (throttle.LockedUntil <= now || throttle.UpdatedAt <= now - settings.FailureWindow)
            {
                // The lock ended or the old tries aged out: start a fresh count.
                throttle.FailedAttempts = 0;
                throttle.LockedUntil = null;
            }
        }

        throttle.FailedAttempts++;
        throttle.UpdatedAt = now;
        var locked = throttle.FailedAttempts >= settings.MaxWrongTries;
        if (locked)
        {
            throttle.LockedUntil = now + settings.LockDuration;
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        if (locked)
        {
            LogLocked(logger, purpose);
            return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Locked, CeilSeconds(settings.LockDuration));
        }

        return new EmailCodeVerifyResult(EmailCodeVerifyStatus.Invalid);
    }

    private async Task VoidOpenAsync(string key, EmailCodePurpose purpose, DateTime now, CancellationToken cancellationToken)
    {
        var open = await db.EmailCodes
            .Where(c => c.Email == key && c.Purpose == purpose && c.ConsumedAt == null && c.ExpiresAt > now)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        foreach (var existing in open)
        {
            existing.ConsumedAt = now;
            existing.Version++;
        }
    }

    private async Task<int> DeleteInBatchesAsync<T>(IQueryable<T> query, CancellationToken cancellationToken)
        where T : class
    {
        var total = 0;
        while (true)
        {
            var batch = await query.Take(PurgeBatchSize).ToListAsync(cancellationToken).ConfigureAwait(false);
            if (batch.Count == 0)
            {
                return total;
            }

            db.Set<T>().RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            total += batch.Count;
            if (batch.Count < PurgeBatchSize)
            {
                return total;
            }
        }
    }
}
