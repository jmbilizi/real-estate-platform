// <copyright file="PostmarkSendResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome Postmark's <c>POST /email</c> endpoint reported for one message.</summary>
/// <param name="Success">Whether Postmark accepted the message for delivery.</param>
/// <param name="MessageId">Postmark's <c>MessageID</c> for the accepted send, if any.</param>
/// <param name="ErrorCode">Postmark's <c>ErrorCode</c>. Zero on success.</param>
/// <param name="Detail">Postmark's <c>Message</c>, describing the outcome.</param>
internal sealed record PostmarkSendResult(bool Success, string? MessageId, int ErrorCode, string Detail);
