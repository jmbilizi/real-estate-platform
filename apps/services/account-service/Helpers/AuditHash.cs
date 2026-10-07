// <copyright file="AuditHash.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Cryptography;
using System.Text;

namespace AccountService.Helpers;

/// <summary>Keyed hashes for the audit rows. A row never holds an address in clear.</summary>
internal static class AuditHash
{
    /// <summary>The label for a client address.</summary>
    internal const string ClientAddress = "client-address";

    /// <summary>The label for a normalized email address.</summary>
    internal const string Email = "email";

    /// <summary>
    /// Hashes a value with HMAC-SHA256. A plain hash of an IPv4 address or an email falls to a
    /// lookup, so the key stays out of the database. The label keeps one digest apart from another.
    /// </summary>
    /// <param name="label">What the value is, for example <see cref="Email"/>.</param>
    /// <param name="value">The value. The method trims it.</param>
    /// <param name="key">The HMAC key.</param>
    /// <returns>The upper-case hex digest, or null when the value is empty.</returns>
    internal static string? Of(string label, string? value, string key)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var hash = HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(key),
            Encoding.UTF8.GetBytes(label + ":" + value.Trim()));
        return Convert.ToHexString(hash);
    }
}
