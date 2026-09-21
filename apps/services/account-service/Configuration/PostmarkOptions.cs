// <copyright file="PostmarkOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Configuration for the Postmark transactional email transport. Section <c>Postmark</c>.
/// </summary>
/// <remarks>
/// <see cref="ServerToken"/> is a secret, supplied as the flat <c>POSTMARK_SERVER_TOKEN</c>
/// environment variable (<c>infra/k8s/base/secrets/postmark.secret.yaml</c>), never through the
/// <c>Postmark</c> configuration section. The committed placeholder
/// (<see cref="PlaceholderServerToken"/>) is the fail-closed sentinel (#138): an environment that
/// has not substituted a real token is read as not configured, and the transport refuses to place
/// the call rather than attempt delivery with it.
/// </remarks>
internal sealed class PostmarkOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "Postmark";

    /// <summary>The committed secret placeholder. Never a usable token.</summary>
    internal const string PlaceholderServerToken = "StrongBase64Password";

    /// <summary>Gets or sets the Postmark server token.</summary>
    public string ServerToken { get; set; } = PlaceholderServerToken;

    /// <summary>
    /// Gets or sets the Postmark Message Stream ID. Must be a transactional stream, never a
    /// broadcast one. <c>outbound</c> is Postmark's default transactional stream.
    /// </summary>
    public string MessageStream { get; set; } = "outbound";

    /// <summary>Gets or sets the Postmark API base address.</summary>
    public Uri ApiBaseUrl { get; set; } = new("https://api.postmarkapp.com/");

    /// <summary>
    /// Gets a value indicating whether a real server token has been substituted for the committed
    /// placeholder. False in an environment where the deploy pipeline has not injected one.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(this.ServerToken)
        && !string.Equals(this.ServerToken, PlaceholderServerToken, StringComparison.Ordinal);

    /// <summary>Validates the members that have no safe default.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(this.MessageStream))
        {
            return $"{SectionName}:{nameof(this.MessageStream)} is required.";
        }

        if (this.ApiBaseUrl is null || !this.ApiBaseUrl.IsAbsoluteUri)
        {
            return $"{SectionName}:{nameof(this.ApiBaseUrl)} must be an absolute URL.";
        }

        return null;
    }
}
