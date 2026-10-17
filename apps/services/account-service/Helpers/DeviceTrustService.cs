// <copyright file="DeviceTrustService.cs" company="PlaceholderCompany">
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
/// Issues, recognizes and removes trusted devices (#818).
/// </summary>
/// <remarks>
/// A device token is 32 random bytes plus an HMAC of those bytes. The HMAC key derives from the
/// email code key (<c>ACCOUNT_SERVICE_EMAIL_CODE_HMAC_KEY</c>), so no new secret exists. The
/// database holds only the SHA-256 hash of the random bytes. A token with a bad signature never
/// reaches the database. With no usable key, no token issues and none is recognized.
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="codeOptions">The code engine options. They hold the key.</param>
/// <param name="options">The device trust options.</param>
/// <param name="timeProvider">The clock.</param>
internal sealed class DeviceTrustService(
    AccountDbContext db,
    IOptions<EmailCodeOptions> codeOptions,
    IOptions<DeviceTrustOptions> options,
    TimeProvider timeProvider)
{
    /// <summary>The request header the web app uses to pass the device cookie value.</summary>
    internal const string TokenHeader = "X-Device-Token";

    /// <summary>The request header that carries a short device label.</summary>
    internal const string LabelHeader = "X-Device-Label";

    /// <summary>The response header that carries a new device token to the web app.</summary>
    internal const string IssuedTokenHeader = "X-Device-Token-Issued";

    /// <summary>The response header that carries the token life in seconds.</summary>
    internal const string IssuedMaxAgeHeader = "X-Device-Max-Age";

    private const int TokenBytes = 32;

    /// <summary>Gets how long an approved device stays trusted.</summary>
    internal TimeSpan Lifetime => options.Value.Lifetime;

    /// <summary>Cleans a label from a header: no control characters, at most the stored length.</summary>
    /// <param name="raw">The header value.</param>
    /// <returns>A label, never empty.</returns>
    internal static string CleanLabel(string? raw)
    {
        var cleaned = new string((raw ?? string.Empty).Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (cleaned.Length > TrustedDevice.MaxLabelLength)
        {
            cleaned = cleaned[..TrustedDevice.MaxLabelLength];
        }

        return cleaned.Length == 0 ? "Unknown device" : cleaned;
    }

    /// <summary>Finds the live device row that the token names for the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="token">The cookie value, or null.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The row, or <see langword="null"/> when the token is absent, forged, expired or foreign.</returns>
    internal async Task<TrustedDevice?> FindAsync(string userId, string? token, CancellationToken cancellationToken = default)
    {
        if (!this.TryReadToken(token, out var raw))
        {
            return null;
        }

        var hash = SHA256.HashData(raw);
        var now = this.Now();
        return await db.TrustedDevices
            .FirstOrDefaultAsync(d => d.TokenHash == hash && d.UserId == userId && d.ExpiresAt > now, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Records a sign-in on a recognized device.</summary>
    /// <param name="device">The device.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the row is saved.</returns>
    internal async Task TouchAsync(TrustedDevice device, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(device);
        device.LastUsedAt = this.Now();
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            // The device was removed in parallel. The sign-in still stands.
        }
    }

    /// <summary>Approves a device and returns its signed token.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="label">A short device name.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The signed token, or <see langword="null"/> when the engine has no key.</returns>
    internal async Task<string?> IssueAsync(string userId, string? label, CancellationToken cancellationToken = default)
    {
        var key = this.SigningKey();
        if (key is null)
        {
            return null;
        }

        var raw = RandomNumberGenerator.GetBytes(TokenBytes);
        var now = this.Now();
        db.TrustedDevices.Add(new TrustedDevice
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = SHA256.HashData(raw),
            Label = CleanLabel(label),
            FirstSeenAt = now,
            LastUsedAt = now,
            ExpiresAt = now + options.Value.Lifetime,
        });
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        // Keep the newest MaxDevices. The least recently used rows drop first.
        var excess = await db.TrustedDevices
            .Where(d => d.UserId == userId)
            .OrderByDescending(d => d.LastUsedAt)
            .Skip(options.Value.MaxDevices)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (excess.Count > 0)
        {
            db.TrustedDevices.RemoveRange(excess);
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        return Base64Url.EncodeToString(raw) + "." + Base64Url.EncodeToString(HMACSHA256.HashData(key, raw));
    }

    /// <summary>Lists the account's live devices, newest use first.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The devices.</returns>
    internal async Task<IReadOnlyList<TrustedDevice>> ListAsync(string userId, CancellationToken cancellationToken = default)
    {
        var now = this.Now();
        return await db.TrustedDevices
            .AsNoTracking()
            .Where(d => d.UserId == userId && d.ExpiresAt > now)
            .OrderByDescending(d => d.LastUsedAt)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Removes one device of the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="deviceId">The device row id.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns><see langword="true"/> when a row was removed.</returns>
    internal async Task<bool> RemoveAsync(string userId, Guid deviceId, CancellationToken cancellationToken = default)
    {
        var row = await db.TrustedDevices
            .FirstOrDefaultAsync(d => d.UserId == userId && d.Id == deviceId, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            return false;
        }

        db.TrustedDevices.Remove(row);
        await this.SaveIgnoringRaceAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>Removes every device of the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>A task that completes when the rows are gone.</returns>
    internal async Task RemoveAllAsync(string userId, CancellationToken cancellationToken = default)
    {
        var rows = await db.TrustedDevices.Where(d => d.UserId == userId).ToListAsync(cancellationToken).ConfigureAwait(false);
        db.TrustedDevices.RemoveRange(rows);
        await this.SaveIgnoringRaceAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Deletes expired devices.</summary>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The number of rows removed.</returns>
    internal async Task<int> PurgeAsync(CancellationToken cancellationToken = default)
    {
        var now = this.Now();
        var expired = await db.TrustedDevices.Where(d => d.ExpiresAt <= now).ToListAsync(cancellationToken).ConfigureAwait(false);
        db.TrustedDevices.RemoveRange(expired);
        await this.SaveIgnoringRaceAsync(cancellationToken).ConfigureAwait(false);
        return expired.Count;
    }

    private async Task SaveIgnoringRaceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another request removed the row first. The goal is met.
        }
    }

    private DateTime Now() => timeProvider.GetUtcNow().UtcDateTime;

    private byte[]? SigningKey()
    {
        var settings = codeOptions.Value;
        return settings.IsConfigured
            ? HMACSHA256.HashData(Encoding.UTF8.GetBytes(settings.HmacKey), "device-trust-v1"u8)
            : null;
    }

    private bool TryReadToken(string? token, out byte[] raw)
    {
        raw = Array.Empty<byte>();
        var key = this.SigningKey();
        if (key is null || string.IsNullOrEmpty(token) || token.Length > 256)
        {
            return false;
        }

        var parts = token.Split('.');
        if (parts.Length != 2
            || !Base64Url.IsValid(parts[0])
            || !Base64Url.IsValid(parts[1]))
        {
            return false;
        }

        var bytes = Base64Url.DecodeFromChars(parts[0]);
        var signature = Base64Url.DecodeFromChars(parts[1]);
        if (bytes.Length != TokenBytes
            || !CryptographicOperations.FixedTimeEquals(signature, HMACSHA256.HashData(key, bytes)))
        {
            return false;
        }

        raw = bytes;
        return true;
    }
}
