// <copyright file="EmailCodeOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Policy and key for the email code engine. Section <c>EmailCodes</c>.
/// </summary>
/// <remarks>
/// <see cref="HmacKey"/> is a secret, supplied as the flat <c>ACCOUNT_SERVICE_EMAIL_CODE_HMAC_KEY</c> environment
/// variable. A 6-digit space falls to a plain hash in microseconds, so the key must stay out of
/// the database. With no usable key the engine is not configured and refuses every call
/// (fail closed). Only the Development and Testing environments fall back to a fixed dev key.
/// </remarks>
internal sealed class EmailCodeOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "EmailCodes";

    /// <summary>The environment variable that carries the key.</summary>
    public const string KeyVariable = "ACCOUNT_SERVICE_EMAIL_CODE_HMAC_KEY";

    /// <summary>The committed secret placeholder. Never a usable key.</summary>
    internal const string PlaceholderKey = "StrongBase64Password";

    /// <summary>The key used in Development and Testing when none is supplied. Never used elsewhere.</summary>
    internal const string DevelopmentKey = "dev-only-email-code-key-not-a-secret-0123456789";

    /// <summary>The shortest key the engine accepts, in characters.</summary>
    internal const int MinimumKeyLength = 32;

    /// <summary>The longest life NIST SP 800-63B-4 allows for an out-of-band code.</summary>
    internal static readonly TimeSpan MaximumLifetime = TimeSpan.FromMinutes(10);

    /// <summary>Gets or sets the number of digits in a code.</summary>
    public int CodeLength { get; set; } = 6;

    /// <summary>Gets or sets how long a code works.</summary>
    public TimeSpan Lifetime { get; set; } = TimeSpan.FromMinutes(10);

    /// <summary>Gets or sets the wrong tries that lock an email and purpose.</summary>
    public int MaxWrongTries { get; set; } = 5;

    /// <summary>Gets or sets how long a lock lasts.</summary>
    public TimeSpan LockDuration { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>Gets or sets how long wrong tries count after the last one.</summary>
    public TimeSpan FailureWindow { get; set; } = TimeSpan.FromDays(1);

    /// <summary>Gets or sets the minimum time between two codes for one email and purpose.</summary>
    public TimeSpan ResendCooldown { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>Gets or sets the codes allowed per email and purpose in one hour.</summary>
    public int MaxPerHour { get; set; } = 5;

    /// <summary>Gets or sets the codes allowed per email and purpose in 24 hours.</summary>
    public int MaxPerDay { get; set; } = 10;

    /// <summary>Gets or sets how often the purge runs.</summary>
    public TimeSpan PurgeInterval { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Gets or sets the HMAC key. <c>Program</c> sets it from <c>ACCOUNT_SERVICE_EMAIL_CODE_HMAC_KEY</c> after
    /// binding and overwrites any value in the section, so a committed key has no effect.
    /// </summary>
    public string HmacKey { get; set; } = string.Empty;

    /// <summary>Gets a value indicating whether a usable key is present.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(this.HmacKey)
        && this.HmacKey.Length >= MinimumKeyLength
        && !string.Equals(this.HmacKey, PlaceholderKey, StringComparison.Ordinal);

    /// <summary>
    /// Validates every policy value. A missing, short or placeholder key is not an error: the
    /// engine then refuses every call (see <see cref="IsConfigured"/>) instead of failing the start.
    /// </summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (this.CodeLength is < 6 or > 9)
        {
            return $"{SectionName}:{nameof(this.CodeLength)} must be 6 to 9.";
        }

        if (this.Lifetime <= TimeSpan.Zero || this.Lifetime > MaximumLifetime)
        {
            return $"{SectionName}:{nameof(this.Lifetime)} must be positive and at most 10 minutes.";
        }

        if (this.MaxWrongTries < 1)
        {
            return $"{SectionName}:{nameof(this.MaxWrongTries)} must be at least 1.";
        }

        if (this.LockDuration <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.LockDuration)} must be positive.";
        }

        if (this.FailureWindow < this.LockDuration)
        {
            return $"{SectionName}:{nameof(this.FailureWindow)} must be at least {nameof(this.LockDuration)}.";
        }

        if (this.ResendCooldown < TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.ResendCooldown)} must not be negative.";
        }

        if (this.MaxPerHour < 1)
        {
            return $"{SectionName}:{nameof(this.MaxPerHour)} must be at least 1.";
        }

        if (this.MaxPerDay < this.MaxPerHour)
        {
            return $"{SectionName}:{nameof(this.MaxPerDay)} must be at least {nameof(this.MaxPerHour)}.";
        }

        if (this.PurgeInterval <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.PurgeInterval)} must be positive.";
        }

        return null;
    }
}
