// <copyright file="EmailDeliverabilityOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>Policy for the address check before a code is sent. Section <c>EmailDeliverability</c>.</summary>
internal sealed class EmailDeliverabilityOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "EmailDeliverability";

    /// <summary>Gets or sets a value indicating whether the MX lookup runs.</summary>
    public bool MxCheckEnabled { get; set; } = true;

    /// <summary>Gets or sets the longest the whole lookup may take. A longer lookup fails open.</summary>
    public TimeSpan DnsTimeout { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>Validates the policy values.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate() =>
        this.DnsTimeout <= TimeSpan.Zero
            ? $"{SectionName}:{nameof(this.DnsTimeout)} must be positive."
            : null;
}
