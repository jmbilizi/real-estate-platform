// <copyright file="CredentialIntrospector.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Resolves a credential forwarded verbatim by the gateway (session cookie, opaque bearer token or
/// API key) to an account id plus validity flags.
/// <para>
/// This deliberately does <b>not</b> go through <see cref="IAuthenticationService"/>. Two reasons:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Revocation must be observable.</b> <c>SecurityStampValidatorOptions.ValidationInterval</c> is
/// <see cref="TimeSpan.Zero"/>, so the cookie handler runs the security-stamp validator as its own
/// <c>OnValidatePrincipal</c> and rejects a revoked principal inside <c>AuthenticateAsync</c> — the
/// caller only gets back the string <c>"No principal."</c>. Deriving <c>isRevoked</c> from framework
/// failure messages is not a contract we can rely on, so the ticket is unprotected here with the
/// framework's own protector and the stamp check is run explicitly, yielding a typed answer.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Resolution itself stays a read.</b> Driving the cookie handler for the answer would renew the
/// session on every lookup. Note this does not make the whole request side-effect free:
/// <c>UseAuthentication()</c> already authenticates the default (cookie) scheme on every request to
/// every endpoint, and with <c>ValidationInterval = Zero</c> the security-stamp validator re-signs
/// the principal in, so a cookie-carrying request still leaves with a refreshed <c>Set-Cookie</c>.
/// That is service-wide behaviour, not something this endpoint introduces — see the README's caller
/// guidance about discarding introspection response headers.
/// </description>
/// </item>
/// </list>
/// </summary>
/// <param name="cookieOptions">Monitor used to read the Identity application cookie's name and ticket format.</param>
/// <param name="bearerOptions">Monitor used to read the Identity bearer token's protector.</param>
/// <param name="signInManager">Sign-in manager used for the explicit security-stamp check.</param>
/// <param name="db">Database context used to validate API keys.</param>
internal sealed class CredentialIntrospector(
    IOptionsMonitor<CookieAuthenticationOptions> cookieOptions,
    IOptionsMonitor<BearerTokenOptions> bearerOptions,
    SignInManager<ApplicationUser> signInManager,
    AccountDbContext db)
{
    private const string CookieCredentialType = "cookie";
    private const string BearerCredentialType = "bearer";
    private const string ApiKeyCredentialType = "apiKey";

    /// <summary>
    /// Introspects every credential shape present on the request, in the order API key → bearer → cookie.
    /// </summary>
    /// <remarks>
    /// The first shape that resolves to an active account wins. This mirrors how account-service
    /// authorizes its own endpoints (the default policy lists all three schemes, and the policy
    /// evaluator tries each), so a stale <c>Authorization</c> header travelling alongside a valid
    /// session cookie cannot silently defeat the cookie. When nothing resolves, the highest-precedence
    /// shape that was actually present supplies the reported <c>credentialType</c> and flags.
    /// </remarks>
    /// <param name="request">The incoming request carrying the forwarded credential(s).</param>
    /// <returns>The introspection result.</returns>
    internal async Task<IntrospectionResult> IntrospectAsync(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        IntrospectionResult? firstPresent = null;

        if (TryGetApiKey(request, out var rawApiKey))
        {
            var outcome = await ResolveApiKeyAsync(rawApiKey).ConfigureAwait(false);
            if (outcome.IsValid)
            {
                return outcome;
            }

            firstPresent = outcome;
        }

        if (TryGetBearerToken(request, out var bearerToken))
        {
            var protector = bearerOptions.Get(IdentityConstants.BearerScheme).BearerTokenProtector;
            var outcome = await ResolveTicketAsync(BearerCredentialType, protector.Unprotect(bearerToken))
                .ConfigureAwait(false);
            if (outcome.IsValid)
            {
                return outcome;
            }

            firstPresent ??= outcome;
        }

        if (TryGetSessionCookie(request, out var cookieValue))
        {
            var format = cookieOptions.Get(IdentityConstants.ApplicationScheme).TicketDataFormat;
            var outcome = await ResolveTicketAsync(CookieCredentialType, format.Unprotect(cookieValue))
                .ConfigureAwait(false);
            if (outcome.IsValid)
            {
                return outcome;
            }

            firstPresent ??= outcome;
        }

        return firstPresent ?? IntrospectionResult.NoCredential;
    }

    private static bool TryGetApiKey(HttpRequest request, out string rawApiKey)
    {
        rawApiKey = request.Headers.TryGetValue(ApiKeyDefaults.HeaderName, out var values)
            ? values.ToString()
            : string.Empty;

        return !string.IsNullOrWhiteSpace(rawApiKey);
    }

    /// <summary>
    /// Extracts the token from an <c>Authorization</c> header.
    /// </summary>
    /// <remarks>
    /// The auth-scheme token is matched case-insensitively per RFC 7235 §2.1, which matches how
    /// <c>Program.cs</c> configures <c>BearerTokenEvents.OnMessageReceived</c> for the Identity
    /// bearer scheme. Detection here and validation there therefore agree: a token forwarded as
    /// <c>authorization: bearer &lt;token&gt;</c> introspects exactly as account-service treats it.
    /// </remarks>
    private static bool TryGetBearerToken(HttpRequest request, out string token)
    {
        token = string.Empty;

        if (!request.Headers.TryGetValue("Authorization", out var values))
        {
            return false;
        }

        var candidate = BearerTokenHeader.Parse(values.ToString());
        if (candidate is null)
        {
            return false;
        }

        token = candidate;
        return true;
    }

    private bool TryGetSessionCookie(HttpRequest request, out string cookieValue)
    {
        var cookieName = cookieOptions.Get(IdentityConstants.ApplicationScheme).Cookie.Name
            ?? CookieAuthenticationDefaults.CookiePrefix + IdentityConstants.ApplicationScheme;

        cookieValue = request.Cookies[cookieName] ?? string.Empty;
        return !string.IsNullOrWhiteSpace(cookieValue);
    }

    private async Task<IntrospectionResult> ResolveApiKeyAsync(string rawApiKey)
    {
        var validation = await ApiKeyValidation.ValidateAsync(db, rawApiKey).ConfigureAwait(false);

        return validation.Status switch
        {
            ApiKeyValidationStatus.Valid => IntrospectionResult.Valid(
                ApiKeyCredentialType,
                validation.ApiKey!.User!.Id),
            ApiKeyValidationStatus.Revoked or ApiKeyValidationStatus.OwnerUnavailable =>
                IntrospectionResult.Invalid(ApiKeyCredentialType, revoked: true),
            ApiKeyValidationStatus.Expired =>
                IntrospectionResult.Invalid(ApiKeyCredentialType, expired: true),
            _ => IntrospectionResult.Invalid(ApiKeyCredentialType),
        };
    }

    /// <summary>
    /// Turns an unprotected cookie/bearer ticket into a typed introspection result.
    /// </summary>
    /// <remarks>
    /// A ticket that fails to unprotect (tampered, truncated, or protected with different keys)
    /// comes back as <see langword="null"/> from <see cref="ISecureDataFormat{TData}.Unprotect(string?)"/>
    /// rather than throwing, so malformed input is a definitive negative rather than a 500.
    /// </remarks>
    private async Task<IntrospectionResult> ResolveTicketAsync(string credentialType, AuthenticationTicket? ticket)
    {
        if (ticket?.Principal is null)
        {
            return IntrospectionResult.Invalid(credentialType);
        }

        var expiresUtc = ticket.Properties?.ExpiresUtc;
        if (expiresUtc is not null && expiresUtc.Value <= DateTimeOffset.UtcNow)
        {
            return IntrospectionResult.Invalid(credentialType, expired: true);
        }

        // The single source of isRevoked: the stored security stamp, re-read on every call.
        var user = await signInManager.ValidateSecurityStampAsync(ticket.Principal).ConfigureAwait(false);
        if (user is null || user.DeletedAt.HasValue)
        {
            return IntrospectionResult.Invalid(credentialType, revoked: true);
        }

        return IntrospectionResult.Valid(credentialType, user.Id);
    }
}
