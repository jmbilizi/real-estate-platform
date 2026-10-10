// <copyright file="InternalCallerOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Cryptography;
using System.Text;

namespace AccountService.Configuration;

/// <summary>
/// The shared secret an internal caller (the Notification Service, #696) sends in the
/// <c>X-Internal-Key</c> header (#694). It is defence in depth next to the network policy (#269).
/// The secret comes only from <c>ACCOUNT_SERVICE_INTERNAL_KEY</c>. With no usable key the endpoint
/// answers 403 to every call (fail closed). There is no development fallback.
/// </summary>
internal sealed class InternalCallerOptions
{
    /// <summary>The environment variable that carries the key.</summary>
    public const string KeyVariable = "ACCOUNT_SERVICE_INTERNAL_KEY";

    /// <summary>The request header that carries the key.</summary>
    public const string HeaderName = "X-Internal-Key";

    /// <summary>The shortest key accepted, in characters.</summary>
    internal const int MinimumKeyLength = 32;

    /// <summary>Gets or sets the shared key.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Checks a presented key in constant time.</summary>
    /// <param name="presented">The header value.</param>
    /// <returns><see langword="true"/> when a key is configured and the value equals it.</returns>
    internal bool IsAuthorized(string? presented)
    {
        if (string.IsNullOrEmpty(presented)
            || this.Key.Length < MinimumKeyLength
            || string.Equals(this.Key, EmailCodeOptions.PlaceholderKey, StringComparison.Ordinal))
        {
            return false;
        }

        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(this.Key));
        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(presented));
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }
}
