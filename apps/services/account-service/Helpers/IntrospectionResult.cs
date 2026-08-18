// <copyright file="IntrospectionResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// The wire response of the internal credential introspection endpoint.
/// <para>
/// Deliberately carries identity and validity only — no profile PII and no role or
/// <c>user_type</c> field: accounts are multi-role (PRD §11.2) and identity resolution
/// must not invent a persona.
/// </para>
/// </summary>
/// <param name="IsValid">Whether the forwarded credential resolves to an active account.</param>
/// <param name="CredentialType">The credential shape that produced this answer: <c>cookie</c>, <c>bearer</c>, <c>apiKey</c> or <c>none</c>.</param>
/// <param name="AccountId">The resolved account id, or <see langword="null"/> when the credential is not valid.</param>
/// <param name="IsRevoked">Whether the credential was rejected because it (or its account) was revoked.</param>
/// <param name="IsExpired">Whether the credential was rejected because it had expired.</param>
internal sealed record IntrospectionResult(
    bool IsValid,
    string CredentialType,
    string? AccountId,
    bool IsRevoked,
    bool IsExpired)
{
    /// <summary>Gets the response returned when the request carries no recognised credential at all.</summary>
    internal static IntrospectionResult NoCredential { get; } = new(false, "none", null, false, false);

    /// <summary>
    /// Builds a positive result.
    /// </summary>
    /// <param name="credentialType">The credential shape that resolved.</param>
    /// <param name="accountId">The resolved account id.</param>
    /// <returns>A valid introspection result.</returns>
    internal static IntrospectionResult Valid(string credentialType, string accountId) =>
        new(true, credentialType, accountId, false, false);

    /// <summary>
    /// Builds a definitive negative result.
    /// </summary>
    /// <param name="credentialType">The credential shape that was presented.</param>
    /// <param name="revoked">Whether the credential (or its account) was revoked.</param>
    /// <param name="expired">Whether the credential had expired.</param>
    /// <returns>An invalid introspection result.</returns>
    internal static IntrospectionResult Invalid(string credentialType, bool revoked = false, bool expired = false) =>
        new(false, credentialType, null, revoked, expired);
}
