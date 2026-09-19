// <copyright file="OutboundEmail.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>A composed transactional message, ready for a transport.</summary>
/// <param name="FromName">The sender display name.</param>
/// <param name="FromAddress">The sender address.</param>
/// <param name="ReplyToAddress">The monitored reply-to address.</param>
/// <param name="To">The recipient.</param>
/// <param name="Subject">The subject line.</param>
/// <param name="TextBody">The plain-text body.</param>
internal sealed record OutboundEmail(
    string FromName,
    string FromAddress,
    string ReplyToAddress,
    string To,
    string Subject,
    string TextBody);
