// <copyright file="OutboundEmail.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>Which transactional message an <see cref="OutboundEmail"/> is, for logging and metrics.</summary>
internal enum EmailKind
{
    /// <summary>An email-confirmation link.</summary>
    Confirmation,

    /// <summary>A password-reset link.</summary>
    PasswordReset,

    /// <summary>A notice that someone tried to register an address that already has an account.</summary>
    AlreadyRegistered,
}

/// <summary>A composed transactional message, ready for a transport.</summary>
/// <param name="Kind">Which message this is.</param>
/// <param name="FromName">The sender display name.</param>
/// <param name="FromAddress">The sender address.</param>
/// <param name="ReplyToAddress">The monitored reply-to address.</param>
/// <param name="To">The recipient.</param>
/// <param name="Subject">The subject line.</param>
/// <param name="TextBody">The plain-text body.</param>
internal sealed record OutboundEmail(
    EmailKind Kind,
    string FromName,
    string FromAddress,
    string ReplyToAddress,
    string To,
    string Subject,
    string TextBody);
