// <copyright file="IdentityEmailComposer.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Composes the three messages Identity asks <c>IEmailSender&lt;TUser&gt;</c> to send.
/// </summary>
/// <remarks>
/// Every sender, including the Postmark transport #138 adds, composes through this class. It is
/// the one place the sender identity and the confirmation link are applied. Every body ends with
/// the configured brokerage disclosure (PRD §6 brand prominence).
/// </remarks>
/// <param name="email">The sender identity.</param>
/// <param name="links">The confirmation link builder.</param>
internal sealed class IdentityEmailComposer(
    IOptions<TransactionalEmailOptions> email,
    ConfirmationLinkBuilder links)
{
    private const string ConfirmSubject = "Confirm your email address for Cribstop";
    private const string ResetSubject = "Reset your Cribstop password";
    private const string IgnoreIfNotYou = "If you did not create a Cribstop account, ignore this message.";
    private const string IgnoreIfNotReset = "If you did not ask to reset your password, ignore this message.";

    /// <summary>Composes the email-confirmation message.</summary>
    /// <param name="to">The recipient.</param>
    /// <param name="identityLink">The link Identity generated. It is rebuilt onto the web origin.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail ConfirmationLink(string to, string identityLink)
    {
        var link = links.Rebuild(identityLink);
        var body = $"Open this link to confirm your email address:\n\n{link}\n\n{IgnoreIfNotYou}";
        return this.Compose(to, ConfirmSubject, body);
    }

    /// <summary>Composes the password-reset code message.</summary>
    /// <param name="to">The recipient.</param>
    /// <param name="resetCode">The reset code. Identity HTML-encodes it.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail PasswordResetCode(string to, string resetCode)
    {
        var body = $"Your password reset code is:\n\n{WebUtility.HtmlDecode(resetCode)}\n\n{IgnoreIfNotReset}";
        return this.Compose(to, ResetSubject, body);
    }

    /// <summary>Composes the password-reset link message.</summary>
    /// <param name="to">The recipient.</param>
    /// <param name="resetLink">The reset link. Identity HTML-encodes it.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail PasswordResetLink(string to, string resetLink)
    {
        var body = $"Open this link to reset your password:\n\n{WebUtility.HtmlDecode(resetLink)}\n\n{IgnoreIfNotReset}";
        return this.Compose(to, ResetSubject, body);
    }

    private OutboundEmail Compose(string to, string subject, string body)
    {
        var sender = email.Value;
        return new OutboundEmail(
            sender.FromName,
            sender.FromAddress,
            sender.ReplyToAddress,
            to,
            subject,
            $"{body}\n\n{sender.BrokerageDisclosure}");
    }
}
