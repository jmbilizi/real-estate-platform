// <copyright file="SecurityNoticeService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Sends the security notices of #661. A notice goes to the address the account had BEFORE the
/// change, so a thief who changed it cannot hide the change.
/// </summary>
/// <remarks>
/// Each notice carries a "This wasn't me" link with a single-use token. #662 builds the page and
/// consumes the token. A notice never blocks the action: every failure is swallowed and logged by
/// kind only. No log line holds an address or a token. A suppressed address (#664) gets no notice.
/// </remarks>
/// <param name="db">The account database.</param>
/// <param name="sender">The delivery seam.</param>
/// <param name="suppressions">The suppression list.</param>
/// <param name="composer">The message composer.</param>
/// <param name="recovery">The recovery policy, for the web origin.</param>
/// <param name="timeProvider">The clock.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class SecurityNoticeService(
    AccountDbContext db,
    IOutboundEmailSender sender,
    EmailSuppressionService suppressions,
    IdentityEmailComposer composer,
    IOptions<AccountRecoveryOptions> recovery,
    TimeProvider timeProvider,
    ILogger<SecurityNoticeService> logger)
{
    /// <summary>How long the "This wasn't me" token works.</summary>
    internal static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(7);

    private const int TokenBytes = 32;
    private const int PurgeBatchSize = 500;

    /// <summary>Masks the middle of an address: <c>jane@gmail.com</c> becomes <c>j***@gmail.com</c>.</summary>
    /// <param name="address">The address.</param>
    /// <returns>The masked address.</returns>
    internal static string MaskEmail(string address)
    {
        var at = address.LastIndexOf('@');
        if (at < 1)
        {
            return "***";
        }

        var first = at > 1 ? address[..1] : string.Empty;
        return $"{first}***{address[at..]}";
    }

    /// <summary>Hashes a token the way the table stores it.</summary>
    /// <param name="token">The token.</param>
    /// <returns>The SHA-256 hash.</returns>
    internal static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    /// <summary>Sends the notice for a password change or reset to the account's address.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="address">The address the account has now and had before.</param>
    /// <param name="eventKind"><see cref="AccountSecurityEvent.PasswordChanged"/> or <see cref="AccountSecurityEvent.PasswordReset"/>.</param>
    /// <returns>A task that never faults.</returns>
    internal Task NotifyPasswordChangedAsync(string userId, string? address, string eventKind) =>
        this.SendAsync(
            EmailKind.PasswordChangedNotice,
            userId,
            address,
            eventKind,
            (to, when, link) => composer.PasswordChangedNotice(
                to,
                eventKind == AccountSecurityEvent.PasswordReset,
                when,
                link,
                TokenLifetime));

    /// <summary>Sends the notice for an email change to the OLD address.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="oldAddress">The address before the change.</param>
    /// <param name="newAddress">The address after the change. The notice shows it masked.</param>
    /// <returns>A task that never faults.</returns>
    internal Task NotifyEmailChangedAsync(string userId, string? oldAddress, string newAddress) =>
        this.SendAsync(
            EmailKind.EmailChangedNotice,
            userId,
            oldAddress,
            AccountSecurityEvent.EmailChanged,
            (to, when, link) => composer.EmailChangedNotice(to, MaskEmail(newAddress), when, link, TokenLifetime));

    /// <summary>Removes tokens that expired.</summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows removed.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var total = 0;
        while (true)
        {
            var batch = await db.SecureAccountTokens
                .Where(t => t.ExpiresAt <= now)
                .Take(PurgeBatchSize)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            if (batch.Count == 0)
            {
                return total;
            }

            db.SecureAccountTokens.RemoveRange(batch);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            total += batch.Count;
            if (batch.Count < PurgeBatchSize)
            {
                return total;
            }
        }
    }

    [LoggerMessage(1395, LogLevel.Warning, "The {Kind} security notice was not sent: {Reason}.", EventName = "SecurityNoticeSkipped")]
    private static partial void LogSkipped(ILogger logger, EmailKind kind, string reason);

    [LoggerMessage(1396, LogLevel.Error, "The {Kind} security notice failed: {ErrorType}.", EventName = "SecurityNoticeFailed")]
    private static partial void LogFailed(ILogger logger, EmailKind kind, string errorType);

    private async Task SendAsync(
        EmailKind kind,
        string userId,
        string? address,
        string eventKind,
        Func<string, DateTime, Uri, OutboundEmail> compose)
    {
        SecureAccountToken? row = null;
        try
        {
            if (!SignUpEmail.TryNormalize(address, out var key, out var to))
            {
                LogSkipped(logger, kind, "no valid address");
                return;
            }

            if (await suppressions.IsSuppressedAsync(key).ConfigureAwait(false))
            {
                LogSkipped(logger, kind, "address suppressed");
                return;
            }

            var now = timeProvider.GetUtcNow().UtcDateTime;
            var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenBytes));

            // Build the message first: a bad link setting must not leave an orphan token row.
            var message = compose(to, now, this.BuildLink(token));
            row = new SecureAccountToken
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Kind = eventKind,
                TokenHash = HashToken(token),
                CreatedAt = now,
                ExpiresAt = now + TokenLifetime,
            };
            db.SecureAccountTokens.Add(row);
            await db.SaveChangesAsync().ConfigureAwait(false);

            await sender.SendAsync(message).ConfigureAwait(false);
        }
#pragma warning disable CA1031 // A notice must never fail the action it reports.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            // The action is done. A notice must not undo it. Log the type only: a message can hold an address.
            if (row is not null)
            {
                // Detach only the notice row. The caller shares this context and tracks its own entities.
                db.Entry(row).State = EntityState.Detached;
            }

            LogFailed(logger, kind, ex.GetType().Name);
        }
    }

    private Uri BuildLink(string token)
    {
        var settings = recovery.Value;
        var origin = settings.WebBaseUrl ?? throw new InvalidOperationException("WebBaseUrl is not configured.");
        var target = new Uri(origin, settings.SecureAccountPath);
        return new Uri(QueryHelpers.AddQueryString(target.GetLeftPart(UriPartial.Path), "token", token));
    }
}
