// <copyright file="IntrospectionResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.Json.Serialization;

namespace AccountService.Helpers;

/// <summary>
/// The wire response of the internal credential introspection endpoint.
/// <para>
/// Carries identity and validity. For a valid credential it also carries the account's <b>roles as a
/// list</b>, its email and whether the email is confirmed. Roles are additive facets, never a persona:
/// accounts are multi-role (PRD §11.2) and there is no <c>user_type</c> field.
/// </para>
/// <para>
/// <c>Roles</c>, <c>Email</c> and <c>EmailConfirmed</c> are omitted from the JSON unless
/// <c>IsValid</c> is true. Callers must read an absent field as "unknown", never as "no roles".
/// </para>
/// </summary>
/// <param name="IsValid">Whether the forwarded credential resolves to an active account.</param>
/// <param name="CredentialType">The credential shape that produced this answer: <c>cookie</c>, <c>bearer</c>, <c>apiKey</c> or <c>none</c>.</param>
/// <param name="AccountId">The resolved account id, or <see langword="null"/> when the credential is not valid.</param>
/// <param name="IsRevoked">Whether the credential was rejected because it (or its account) was revoked.</param>
/// <param name="IsExpired">Whether the credential was rejected because it had expired.</param>
/// <param name="Roles">The account's role names. Present only when valid.</param>
/// <param name="Email">The account's email address. Present only when valid.</param>
/// <param name="EmailConfirmed">Whether the email is confirmed. Present only when valid.</param>
internal sealed record IntrospectionResult(
    bool IsValid,
    string CredentialType,
    string? AccountId,
    bool IsRevoked,
    bool IsExpired,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Roles = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Email = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? EmailConfirmed = null)
{
    /// <summary>Gets the response returned when the request carries no recognised credential at all.</summary>
    internal static IntrospectionResult NoCredential { get; } = new(false, "none", null, false, false);

    /// <summary>
    /// Builds a positive result.
    /// </summary>
    /// <param name="credentialType">The credential shape that resolved.</param>
    /// <param name="accountId">The resolved account id.</param>
    /// <param name="roles">The account's role names.</param>
    /// <param name="email">The account's email address.</param>
    /// <param name="emailConfirmed">Whether the email is confirmed.</param>
    /// <returns>A valid introspection result.</returns>
    internal static IntrospectionResult Valid(
        string credentialType,
        string accountId,
        IReadOnlyList<string> roles,
        string? email,
        bool emailConfirmed) =>
        new(true, credentialType, accountId, false, false, roles, email, emailConfirmed);

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
