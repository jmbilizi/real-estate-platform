// <copyright file="DeviceTrustOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>Policy for trusted devices (#818). Section <c>DeviceTrust</c>.</summary>
internal sealed class DeviceTrustOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "DeviceTrust";

    /// <summary>Gets or sets how long an approved device stays trusted. The web cookie uses the same value.</summary>
    public TimeSpan Lifetime { get; set; } = TimeSpan.FromDays(30);

    /// <summary>Gets or sets how many devices one account keeps. The least recently used device drops first.</summary>
    public int MaxDevices { get; set; } = 20;
}
