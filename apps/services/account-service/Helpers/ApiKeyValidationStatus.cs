// <copyright file="ApiKeyValidationStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>
/// The outcome of validating a raw API key against the database.
/// </summary>
internal enum ApiKeyValidationStatus
{
    /// <summary>No API key was supplied.</summary>
    Missing,

    /// <summary>The supplied key does not match any stored key hash.</summary>
    NotFound,

    /// <summary>The key exists but has been revoked (<see cref="ApiKey.RevokedAt"/> is set).</summary>
    Revoked,

    /// <summary>The key exists but its expiry has passed.</summary>
    Expired,

    /// <summary>The key is intact but the owning account is missing or soft-deleted.</summary>
    OwnerUnavailable,

    /// <summary>The key is usable and its owner is active.</summary>
    Valid,
}
