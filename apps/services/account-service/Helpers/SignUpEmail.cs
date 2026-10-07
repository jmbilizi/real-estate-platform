// <copyright file="SignUpEmail.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net.Mail;

namespace AccountService.Helpers;

/// <summary>Checks and normalizes the address a sign-up step receives.</summary>
internal static class SignUpEmail
{
    /// <summary>
    /// Trims the address and checks its syntax. The key is the trimmed address in upper case, the
    /// form every sign-up table uses. Plus tags and dots stay as typed: two spellings are two
    /// addresses.
    /// </summary>
    /// <param name="input">The submitted address.</param>
    /// <param name="key">The normalized key.</param>
    /// <param name="entered">The trimmed address as typed.</param>
    /// <returns><see langword="true"/> when the address is well formed.</returns>
    internal static bool TryNormalize(string? input, out string key, out string entered)
    {
        key = string.Empty;
        entered = string.Empty;

        var trimmed = input?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > EmailCodeService.MaxEmailLength)
        {
            return false;
        }

        // MailAddress also accepts a display name and comments. The round trip rejects those.
        if (trimmed.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))
            || trimmed.Count(c => c == '@') != 1
            || !MailAddress.TryCreate(trimmed, out var parsed)
            || !string.Equals(parsed.Address, trimmed, StringComparison.Ordinal)
            || !parsed.Host.Contains('.', StringComparison.Ordinal)
            || parsed.Host.StartsWith('.')
            || parsed.Host.EndsWith('.')
            || parsed.User.Length > 64)
        {
            return false;
        }

        entered = trimmed;
        key = trimmed.ToUpperInvariant();
        return true;
    }
}
