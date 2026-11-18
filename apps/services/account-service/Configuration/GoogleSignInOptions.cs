// <copyright file="GoogleSignInOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Settings for "Continue with Google" (#1049). The client ID is the audience a Google ID token
/// must carry. It is public, but it comes from the flat <c>ACCOUNT_SERVICE_GOOGLE_CLIENT_ID</c>
/// environment variable. With no usable value the endpoint answers 503 and nothing else changes.
/// </summary>
internal sealed class GoogleSignInOptions
{
    /// <summary>The environment variable that carries the client ID.</summary>
    public const string ClientIdVariable = "ACCOUNT_SERVICE_GOOGLE_CLIENT_ID";

    /// <summary>The committed secret placeholder. It reads as "not configured".</summary>
    internal const string Placeholder = "StrongBase64Password";

    /// <summary>Gets or sets the OAuth client ID. <c>Program</c> sets it from the environment.</summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>Gets a value indicating whether a usable client ID is present.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(this.ClientId)
        && !string.Equals(this.ClientId, Placeholder, StringComparison.Ordinal);
}
