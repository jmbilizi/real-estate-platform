// <copyright file="PostmarkEvent.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// The fields of a Postmark Bounce, SpamComplaint or SubscriptionChange webhook that this service reads.
/// Postmark sends many more. The body is never logged.
/// </summary>
internal sealed class PostmarkEvent
{
    /// <summary>Gets or sets the event type: <c>Bounce</c>, <c>SpamComplaint</c> or <c>SubscriptionChange</c>.</summary>
    public string? RecordType { get; set; }

    /// <summary>Gets or sets the Postmark message stream the event belongs to.</summary>
    public string? MessageStream { get; set; }

    /// <summary>Gets or sets the address of a Bounce or SpamComplaint event.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets a value indicating whether a Bounce made the address inactive (a hard bounce).</summary>
    public bool? Inactive { get; set; }

    /// <summary>Gets or sets the address of a SubscriptionChange event.</summary>
    public string? Recipient { get; set; }

    /// <summary>Gets or sets a value indicating whether a SubscriptionChange stops sending to the address.</summary>
    public bool? SuppressSending { get; set; }

    /// <summary>Gets or sets why a SubscriptionChange stops sending: HardBounce, SpamComplaint or ManualSuppression.</summary>
    public string? SuppressionReason { get; set; }
}
