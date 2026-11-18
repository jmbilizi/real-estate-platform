// <copyright file="IGoogleIdTokenValidator.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The seam over Google's ID token validation. Tests replace it.</summary>
internal interface IGoogleIdTokenValidator
{
    /// <summary>Validates a token against the Google signing keys.</summary>
    /// <param name="idToken">The raw ID token.</param>
    /// <param name="clientId">The audience the token must carry.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The identity, or <see langword="null"/> when the token is invalid, expired or has another audience.</returns>
    Task<GoogleIdentity?> ValidateAsync(string idToken, string clientId, CancellationToken cancellationToken = default);
}
