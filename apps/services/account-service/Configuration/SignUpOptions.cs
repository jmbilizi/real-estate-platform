// <copyright file="SignUpOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>Policy for pending sign-ups and the sign-up proof. Section <c>SignUp</c>.</summary>
internal sealed class SignUpOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "SignUp";

    /// <summary>Gets or sets how long a pending row lives after its last code.</summary>
    public TimeSpan PendingLifetime { get; set; } = TimeSpan.FromMinutes(30);

    /// <summary>Gets or sets how long a sign-up proof works.</summary>
    public TimeSpan ProofLifetime { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>Gets or sets how often the purge runs.</summary>
    public TimeSpan PurgeInterval { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>Validates the policy values.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (this.PendingLifetime <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.PendingLifetime)} must be positive.";
        }

        if (this.ProofLifetime <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.ProofLifetime)} must be positive.";
        }

        if (this.PurgeInterval <= TimeSpan.Zero)
        {
            return $"{SectionName}:{nameof(this.PurgeInterval)} must be positive.";
        }

        return null;
    }
}
