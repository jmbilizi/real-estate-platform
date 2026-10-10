// <copyright file="UnsubscribeOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// The key for one-click unsubscribe tokens (#694). It is a secret supplied as the flat
/// <c>ACCOUNT_SERVICE_UNSUBSCRIBE_HMAC_KEY</c> environment variable. It is never the sign-in key and never
/// the email code key. With no usable key the service signs no token and the policy lookup refuses marketing and alert mail.
/// Only Development and Testing fall back to a fixed dev key.
/// </summary>
internal sealed class UnsubscribeOptions
{
    /// <summary>The environment variable that carries the key.</summary>
    public const string KeyVariable = "ACCOUNT_SERVICE_UNSUBSCRIBE_HMAC_KEY";

    /// <summary>The key used in Development and Testing when none is supplied.</summary>
    internal const string DevelopmentKey = "dev-only-unsubscribe-key-not-a-secret-0123456789";

    /// <summary>The shortest key accepted, in characters.</summary>
    internal const int MinimumKeyLength = 32;

    /// <summary>Gets or sets the HMAC key. <c>Program</c> sets it from the environment.</summary>
    public string HmacKey { get; set; } = string.Empty;

    /// <summary>Gets a value indicating whether a usable key is present.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(this.HmacKey)
        && this.HmacKey.Length >= MinimumKeyLength
        && !string.Equals(this.HmacKey, EmailCodeOptions.PlaceholderKey, StringComparison.Ordinal);
}
