// <copyright file="TransactionalEmailOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Configuration;

/// <summary>
/// Sender identity for every transactional message this service composes. Section <c>Email</c>.
/// </summary>
/// <remarks>
/// The values are a stakeholder ruling (2026-09-16), recorded on #147 and #133:
/// from <c>Cribstop (Real Broker, LLC) &lt;no-reply@cribstop.com&gt;</c>, reply-to
/// <c>contact@cribstop.com</c>. The reply-to is a monitored human address and is never the
/// no-reply address.
/// </remarks>
internal sealed class TransactionalEmailOptions
{
    /// <summary>The configuration section name.</summary>
    public const string SectionName = "Email";

    /// <summary>Gets or sets the display name of the sender.</summary>
    public string FromName { get; set; } = string.Empty;

    /// <summary>Gets or sets the sender address.</summary>
    public string FromAddress { get; set; } = string.Empty;

    /// <summary>Gets or sets the reply-to address.</summary>
    public string ReplyToAddress { get; set; } = string.Empty;

    /// <summary>Validates that both addresses are set and differ.</summary>
    /// <returns>An error message, or <see langword="null"/> when the options are valid.</returns>
    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(this.FromName) || string.IsNullOrWhiteSpace(this.FromAddress))
        {
            return $"{SectionName}:{nameof(this.FromName)} and {SectionName}:{nameof(this.FromAddress)} are required.";
        }

        if (string.IsNullOrWhiteSpace(this.ReplyToAddress))
        {
            return $"{SectionName}:{nameof(this.ReplyToAddress)} is required.";
        }

        if (string.Equals(this.ReplyToAddress, this.FromAddress, StringComparison.OrdinalIgnoreCase))
        {
            return $"{SectionName}:{nameof(this.ReplyToAddress)} must not be the no-reply address.";
        }

        return null;
    }
}
