// <copyright file="EmailSuppression.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// An address that Postmark will not deliver to. The sign-up paths refuse it before they send a code.
/// The row has no FK to an account: a sign-up has no account yet.
/// </summary>
internal sealed class EmailSuppression
{
    /// <summary>The reason for a hard bounce.</summary>
    public const string HardBounce = "HardBounce";

    /// <summary>The reason for a spam complaint.</summary>
    public const string SpamComplaint = "SpamComplaint";

    /// <summary>The reason for a suppression an operator set in Postmark.</summary>
    public const string ManualSuppression = "ManualSuppression";

    /// <summary>The reason for a send that Postmark refused with error 406.</summary>
    public const string InactiveRecipient = "InactiveRecipient";

    /// <summary>The source for a row written from a Postmark webhook.</summary>
    public const string WebhookSource = "postmark-webhook";

    /// <summary>The source for a row written after a send that Postmark refused.</summary>
    public const string SendSource = "postmark-send";

    /// <summary>Gets or sets the record id.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the normalized (trimmed, upper-case) email address. Unique.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets why the address is suppressed.</summary>
    public string Reason { get; set; } = string.Empty;

    /// <summary>Gets or sets where the row came from.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets the UTC time the row was created.</summary>
    public DateTime CreatedAt { get; set; }
}
