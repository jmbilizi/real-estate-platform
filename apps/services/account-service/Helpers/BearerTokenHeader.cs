// <copyright file="BearerTokenHeader.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// Parses the <c>Authorization</c> header value carrying the platform's opaque bearer tokens.
/// <para>
/// Shared by the Identity bearer scheme (via <c>BearerTokenEvents.OnMessageReceived</c> in
/// <c>Program.cs</c>) and by <see cref="CredentialIntrospector"/>, so credential detection and
/// credential validation cannot drift apart. The framework's own <c>BearerTokenHandler</c> matches
/// the <c>"Bearer "</c> prefix with <see cref="StringComparison.Ordinal"/>, which rejects the
/// case-insensitive auth-scheme token RFC 7235 §2.1 mandates; this parser is what makes the service
/// accept <c>authorization: bearer &lt;token&gt;</c>.
/// </para>
/// </summary>
internal static class BearerTokenHeader
{
    private const string BearerScheme = "Bearer";

    /// <summary>
    /// Returns the token from a <c>Bearer</c> authorization header value, or <see langword="null"/>
    /// when the header is absent, uses a different auth-scheme, or carries an empty token.
    /// </summary>
    /// <param name="headerValue">The raw <c>Authorization</c> header value.</param>
    /// <returns>The bearer token, or <see langword="null"/>.</returns>
    internal static string? Parse(string? headerValue)
    {
        if (string.IsNullOrWhiteSpace(headerValue))
        {
            return null;
        }

        var separatorIndex = headerValue.IndexOf(' ', StringComparison.Ordinal);
        if (separatorIndex <= 0)
        {
            return null;
        }

        // RFC 7235 §2.1: the auth-scheme token is case-insensitive.
        if (!headerValue.AsSpan(0, separatorIndex).Equals(BearerScheme, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = headerValue[(separatorIndex + 1)..].Trim();
        return string.IsNullOrEmpty(token) ? null : token;
    }
}
