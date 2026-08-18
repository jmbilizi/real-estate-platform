// <copyright file="ApiKeyValidation.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using Microsoft.EntityFrameworkCore;

namespace AccountService.Helpers;

/// <summary>
/// Single source of truth for API key validity.
/// <para>
/// Both <see cref="ApiKeyAuthenticationHandler"/> and <see cref="CredentialIntrospector"/> call this,
/// so "why was this key rejected" is a typed value rather than a string each caller has to
/// re-derive from a failure message.
/// </para>
/// </summary>
internal static class ApiKeyValidation
{
    /// <summary>
    /// Validates a raw API key against the stored key hashes.
    /// </summary>
    /// <param name="db">The account database context.</param>
    /// <param name="rawKey">The raw key exactly as supplied in the <c>X-Api-Key</c> header.</param>
    /// <returns>The typed validation result.</returns>
    internal static async Task<ApiKeyValidationResult> ValidateAsync(AccountDbContext db, string? rawKey)
    {
        ArgumentNullException.ThrowIfNull(db);

        if (string.IsNullOrWhiteSpace(rawKey))
        {
            return new ApiKeyValidationResult(ApiKeyValidationStatus.Missing, null);
        }

        var keyHash = Routes.ApiKeys.HashKey(rawKey);

        var apiKey = await db.ApiKeys
            .Include(k => k.User)
            .FirstOrDefaultAsync(k => k.KeyHash == keyHash)
            .ConfigureAwait(false);

        if (apiKey is null)
        {
            return new ApiKeyValidationResult(ApiKeyValidationStatus.NotFound, null);
        }

        if (apiKey.RevokedAt.HasValue)
        {
            return new ApiKeyValidationResult(ApiKeyValidationStatus.Revoked, apiKey);
        }

        if (apiKey.ExpiresAt.HasValue && apiKey.ExpiresAt.Value <= DateTime.UtcNow)
        {
            return new ApiKeyValidationResult(ApiKeyValidationStatus.Expired, apiKey);
        }

        if (apiKey.User is null || apiKey.User.DeletedAt.HasValue)
        {
            return new ApiKeyValidationResult(ApiKeyValidationStatus.OwnerUnavailable, apiKey);
        }

        return new ApiKeyValidationResult(ApiKeyValidationStatus.Valid, apiKey);
    }

    /// <summary>
    /// Maps a failing status onto the message surfaced by the authentication handler.
    /// </summary>
    /// <param name="status">The failing status.</param>
    /// <returns>A human-readable failure message.</returns>
    internal static string FailureMessage(ApiKeyValidationStatus status) => status switch
    {
        ApiKeyValidationStatus.NotFound => "Invalid API key.",
        ApiKeyValidationStatus.Revoked => "API key has been revoked.",
        ApiKeyValidationStatus.Expired => "API key has expired.",
        ApiKeyValidationStatus.OwnerUnavailable => "Account associated with this API key is unavailable.",
        _ => "API key authentication failed.",
    };
}
