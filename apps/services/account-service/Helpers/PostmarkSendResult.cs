// <copyright file="PostmarkSendResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;

namespace AccountService.Helpers;

/// <summary>The outcome Postmark's <c>POST /email</c> endpoint reported for one message.</summary>
/// <param name="Success">Whether Postmark accepted the message for delivery.</param>
/// <param name="StatusCode">The HTTP status Postmark answered with.</param>
/// <param name="MessageId">Postmark's <c>MessageID</c> for the accepted send, if any.</param>
/// <param name="ErrorCode">Postmark's <c>ErrorCode</c>. Zero on success.</param>
/// <param name="Detail">Postmark's <c>Message</c>, describing the outcome.</param>
internal sealed record PostmarkSendResult(bool Success, HttpStatusCode StatusCode, string? MessageId, int ErrorCode, string Detail)
{
    /// <summary>
    /// Gets a value indicating whether this failure is worth retrying: a rate limit or a server-side
    /// error, as opposed to a permanent rejection (bad token, invalid recipient) that a retry cannot
    /// change.
    /// </summary>
    internal bool IsRetryableFailure =>
        !this.Success && (this.StatusCode == HttpStatusCode.TooManyRequests || (int)this.StatusCode >= 500);
}
