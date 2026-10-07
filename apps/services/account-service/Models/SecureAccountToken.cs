// <copyright file="SecureAccountToken.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// The single-use token behind the "This wasn't me" link in a security notice (#661). #662 reads
/// and consumes it. The row holds the SHA-256 hash of the token, never the token.
/// </summary>
internal sealed class SecureAccountToken
{
    /// <summary>Gets or sets the row id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the account the notice is about.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the <see cref="AccountSecurityEvent"/> kind that caused the notice.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Gets or sets the SHA-256 hash of the token.</summary>
    public byte[] TokenHash { get; set; } = Array.Empty<byte>();

    /// <summary>Gets or sets when the token was issued.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets when the token stops working.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>Gets or sets when the token was used, or <see langword="null"/> while it is unused.</summary>
    public DateTime? ConsumedAt { get; set; }
}
