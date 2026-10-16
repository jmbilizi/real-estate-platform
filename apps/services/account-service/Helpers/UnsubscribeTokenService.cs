// <copyright file="UnsubscribeTokenService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Signs and checks the one-click unsubscribe token (#694). The token is
/// <c>base64url(version|accountId|category) "." base64url(HMAC-SHA256)</c>. It holds no email address.
/// It does not expire: an unsubscribe link in an old mail must keep working (CAN-SPAM).
/// </summary>
/// <param name="options">The key options.</param>
internal sealed class UnsubscribeTokenService(IOptions<UnsubscribeOptions> options)
{
    private const string Version = "v1";

    /// <summary>Gets a value indicating whether the service can sign and check tokens.</summary>
    internal bool IsAvailable => options.Value.IsConfigured;

    /// <summary>Signs a token for an account and category.</summary>
    /// <param name="accountId">The account id.</param>
    /// <param name="category">The stored category.</param>
    /// <returns>The token, or <see langword="null"/> when no key is configured.</returns>
    internal string? Create(string accountId, string category)
    {
        if (!this.IsAvailable)
        {
            return null;
        }

        var payload = Base64Url(Encoding.UTF8.GetBytes($"{Version}|{accountId}|{category}"));
        return $"{payload}.{Base64Url(this.Sign(payload))}";
    }

    /// <summary>Checks a token.</summary>
    /// <param name="token">The token.</param>
    /// <param name="accountId">The account id inside a valid token.</param>
    /// <param name="category">The category inside a valid token.</param>
    /// <returns><see langword="true"/> when the signature is valid.</returns>
    internal bool TryValidate(string? token, out string accountId, out string category)
    {
        accountId = string.Empty;
        category = string.Empty;
        if (!this.IsAvailable || string.IsNullOrEmpty(token) || token.Length > 512)
        {
            return false;
        }

        var parts = token.Split('.');
        if (parts.Length != 2 || !TryFromBase64Url(parts[1], out var signature))
        {
            return false;
        }

        if (!CryptographicOperations.FixedTimeEquals(this.Sign(parts[0]), signature))
        {
            return false;
        }

        if (!TryFromBase64Url(parts[0], out var payloadBytes))
        {
            return false;
        }

        var fields = Encoding.UTF8.GetString(payloadBytes).Split('|');
        if (fields.Length != 3 || fields[0] != Version || fields[1].Length == 0 || fields[2].Length == 0)
        {
            return false;
        }

        accountId = fields[1];
        category = fields[2];
        return true;
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool TryFromBase64Url(string value, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + ((4 - (padded.Length % 4)) % 4), '=');
        try
        {
            bytes = Convert.FromBase64String(padded);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private byte[] Sign(string payload) =>
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.Value.HmacKey), Encoding.UTF8.GetBytes($"unsubscribe|{payload}"));
}
