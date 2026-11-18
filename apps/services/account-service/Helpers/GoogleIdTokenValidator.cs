// <copyright file="GoogleIdTokenValidator.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Google.Apis.Auth;

namespace AccountService.Helpers;

/// <summary>
/// Validates Google ID tokens with <c>Google.Apis.Auth</c>. The library checks the signature
/// against Google's cached keys, the issuer (<c>accounts.google.com</c> or
/// <c>https://accounts.google.com</c>), the audience and the expiry.
/// </summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage("Performance", "CA1812:Avoid uninstantiated internal classes", Justification = "Instantiated by dependency injection.")]
internal sealed class GoogleIdTokenValidator : IGoogleIdTokenValidator
{
    /// <inheritdoc/>
    public async Task<GoogleIdentity?> ValidateAsync(string idToken, string clientId, CancellationToken cancellationToken = default)
    {
        try
        {
            var payload = await GoogleJsonWebSignature
                .ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings { Audience = new[] { clientId } })
                .ConfigureAwait(false);

            return string.IsNullOrEmpty(payload.Subject) || string.IsNullOrEmpty(payload.Email)
                ? null
                : new GoogleIdentity(payload.Subject, payload.Email, payload.EmailVerified);
        }
        catch (Exception ex) when (ex is InvalidJwtException or FormatException or ArgumentException or Newtonsoft.Json.JsonException)
        {
            // A token that is not a well-formed JWT throws FormatException or a JSON error before
            // the library reaches its own checks. All of them mean "not a valid Google token".
            return null;
        }
    }
}
