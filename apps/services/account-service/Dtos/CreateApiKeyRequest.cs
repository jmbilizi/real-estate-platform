// <copyright file="CreateApiKeyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.ComponentModel.DataAnnotations;

namespace AccountService.Dtos;

/// <summary>
/// Request body for creating a new API key.
/// </summary>
internal sealed class CreateApiKeyRequest
{
    /// <summary>Gets or sets the human-readable label for this key (e.g. "CI/CD Pipeline").</summary>
    [Required]
    [MaxLength(256)]
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the app this key belongs to (e.g. "cribstop", "admin-portal"). Null means unrestricted to a specific app.</summary>
    [MaxLength(64)]
    public string? AppId { get; set; }

    /// <summary>Gets or sets a space-separated list of permission scopes. Null means full access.</summary>
    [MaxLength(1024)]
    public string? Scopes { get; set; }

    /// <summary>Gets or sets the optional UTC expiration timestamp. Null means the key never expires.</summary>
    public DateTime? ExpiresAt { get; set; }
}
