// <copyright file="PasswordPolicyOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// The password policy. Section <c>PasswordPolicy</c>. There are no composition rules (NIST
/// SP 800-63B-4 section 3.1.1.2). Only length and the breached-password check apply.
/// </summary>
internal sealed class PasswordPolicyOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "PasswordPolicy";

    /// <summary>The longest password the policy accepts. The limit is fixed to bound hashing cost.</summary>
    public const int AbsoluteMaxLength = 128;

    /// <summary>Gets or sets the shortest accepted password.</summary>
    public int MinLength { get; set; } = 15;

    /// <summary>Gets or sets the longest accepted password.</summary>
    public int MaxLength { get; set; } = AbsoluteMaxLength;

    /// <summary>Gets or sets a value indicating whether the breached-password check runs.</summary>
    public bool BreachCheckEnabled { get; set; } = true;

    /// <summary>Gets or sets the base address of the Pwned Passwords range API.</summary>
    public Uri BreachCheckBaseUrl { get; set; } = new("https://api.pwnedpasswords.com/");

    /// <summary>Gets or sets how long the breached-password check waits. A timeout lets the password pass.</summary>
    public TimeSpan BreachCheckTimeout { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>Validates the policy values.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (this.MinLength < 1)
        {
            return $"{SectionName}:{nameof(this.MinLength)} must be at least 1.";
        }

        if (this.MaxLength < this.MinLength || this.MaxLength > AbsoluteMaxLength)
        {
            return $"{SectionName}:{nameof(this.MaxLength)} must be between {nameof(this.MinLength)} and {AbsoluteMaxLength}.";
        }

        // https: the SHA-1 prefix must not cross the network in clear text. The slash: the
        // client appends a relative path, which a base without one would resolve beside it.
        if (!this.BreachCheckBaseUrl.IsAbsoluteUri
            || this.BreachCheckBaseUrl.Scheme != Uri.UriSchemeHttps
            || !this.BreachCheckBaseUrl.AbsolutePath.EndsWith('/'))
        {
            return $"{SectionName}:{nameof(this.BreachCheckBaseUrl)} must be an absolute https URL that ends with '/'.";
        }

        if (this.BreachCheckTimeout <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.BreachCheckTimeout)} must be positive.";
        }

        return null;
    }
}
