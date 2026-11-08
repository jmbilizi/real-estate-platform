// <copyright file="PropertyErasureOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>Settings for the property-service erasure call (#803). Section <c>PropertyErasure</c>.</summary>
internal sealed class PropertyErasureOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "PropertyErasure";

    /// <summary>Gets or sets the in-cluster address of property-service.</summary>
    public Uri BaseUrl { get; set; } = new("http://property-service-svc:3002/");

    /// <summary>Gets or sets how often the sweep runs.</summary>
    public TimeSpan SweepInterval { get; set; } = TimeSpan.FromMinutes(1);

    /// <summary>Gets or sets the timeout of one call.</summary>
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>Gets or sets the longest wait between two attempts for one account.</summary>
    public TimeSpan MaxBackoff { get; set; } = TimeSpan.FromHours(6);

    /// <summary>Gets or sets how many accounts one sweep handles.</summary>
    public int BatchSize { get; set; } = 50;

    /// <summary>Checks the values.</summary>
    /// <returns>A message when a value is wrong, else <see langword="null"/>.</returns>
    internal string? Validate()
    {
        if (this.SweepInterval <= TimeSpan.Zero || this.RequestTimeout <= TimeSpan.Zero || this.MaxBackoff <= TimeSpan.Zero)
        {
            return $"{SectionName} durations must be positive.";
        }

        return this.BatchSize < 1 ? $"{SectionName}:{nameof(this.BatchSize)} must be at least 1." : null;
    }
}
