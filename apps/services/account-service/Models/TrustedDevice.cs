// <copyright file="TrustedDevice.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// A device that passed the new-device email code (#818). The row holds the SHA-256 hash of the
/// device token, never the token. The browser keeps the signed token in an httpOnly cookie.
/// </summary>
internal sealed class TrustedDevice
{
    /// <summary>The longest label, in characters.</summary>
    internal const int MaxLabelLength = 80;

    /// <summary>Gets or sets the row id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the account that owns the device. No foreign key.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the SHA-256 hash of the device token.</summary>
    public byte[] TokenHash { get; set; } = Array.Empty<byte>();

    /// <summary>Gets or sets a short name for the device, such as "Chrome on Windows".</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Gets or sets when the device was first approved.</summary>
    public DateTime FirstSeenAt { get; set; }

    /// <summary>Gets or sets when the device last signed in.</summary>
    public DateTime LastUsedAt { get; set; }

    /// <summary>Gets or sets when the device stops being trusted.</summary>
    public DateTime ExpiresAt { get; set; }
}
