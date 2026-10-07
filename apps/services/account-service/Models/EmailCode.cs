// <copyright file="EmailCode.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One issued email code. The row holds a keyed HMAC of the code, never the code itself.
/// </summary>
/// <remarks>
/// Rows also record issuance for the resend caps. A purge removes a row only after it is consumed
/// or expired and older than the longest cap window.
/// </remarks>
internal sealed class EmailCode
{
    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the normalized (upper-case) email address.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets what the code proves.</summary>
    public EmailCodePurpose Purpose { get; set; }

    /// <summary>Gets or sets the HMAC-SHA256 of the code, bound to the email and purpose.</summary>
    public byte[] CodeHash { get; set; } = Array.Empty<byte>();

    /// <summary>Gets or sets the UTC time of issue.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC time after which the code does not verify.</summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets the UTC time the code stopped being usable: it was verified, or a newer code
    /// or an invalidation voided it. Null while the code is open.
    /// </summary>
    public DateTime? ConsumedAt { get; set; }

    /// <summary>Gets or sets the account id when the purpose needs one. No foreign key.</summary>
    public string? UserId { get; set; }

    /// <summary>Gets or sets the concurrency token. Code raises it on every update.</summary>
    public int Version { get; set; }
}
