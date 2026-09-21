// <copyright file="IdentityEmailComposer.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Composes every transactional message this service sends: the three Identity asks
/// <c>IEmailSender&lt;TUser&gt;</c> to send, plus the already-registered notice #147's
/// non-enumeration guarantee sends by mail instead of by API response.
/// </summary>
/// <remarks>
/// Every sender, including the Postmark transport (#138), composes through this class. It is the
/// one place the sender identity and the links are applied. Every body ends with the configured
/// brokerage disclosure (PRD §6 brand prominence) and states the real configured token lifetime,
/// so the expiry statement can never drift from what is actually enforced.
/// </remarks>
/// <param name="email">The sender identity.</param>
/// <param name="recovery">The account-recovery policy, for the token lifetimes.</param>
/// <param name="confirmationLinks">The confirmation link builder.</param>
/// <param name="resetLinks">The password-reset link builder.</param>
internal sealed class IdentityEmailComposer(
    IOptions<TransactionalEmailOptions> email,
    IOptions<AccountRecoveryOptions> recovery,
    ConfirmationLinkBuilder confirmationLinks,
    PasswordResetLinkBuilder resetLinks)
{
    private const string ConfirmSubject = "Confirm your email address for Cribstop";
    private const string ResetSubject = "Reset your Cribstop password";
    private const string AlreadyRegisteredSubject = "Someone tried to create a Cribstop account with your email address";
    private const string IgnoreIfNotYou = "If you did not create a Cribstop account, ignore this message.";
    private const string IgnoreIfNotReset = "If you did not ask to reset your password, ignore this message.";

    /// <summary>Composes the email-confirmation message.</summary>
    /// <param name="to">The recipient.</param>
    /// <param name="identityLink">The link Identity generated. It is rebuilt onto the web origin.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail ConfirmationLink(string to, string identityLink)
    {
        var link = confirmationLinks.Rebuild(identityLink);
        var expiry = FormatLifetime(recovery.Value.ConfirmationTokenLifetime);
        var body =
            $"Open this link to confirm your email address for your Cribstop account:\n\n{link}\n\n" +
            $"This link expires in {expiry}.\n\n{IgnoreIfNotYou}";
        return this.Compose(EmailKind.Confirmation, to, ConfirmSubject, body);
    }

    /// <summary>Composes the password-reset message from the code Identity issued.</summary>
    /// <remarks>
    /// <c>MapIdentityApi</c>'s <c>/forgotPassword</c> endpoint calls only this member, never
    /// <see cref="PasswordResetLink"/> — it always issues a bare code, never a URL. The consumer
    /// still receives a link: this builds one from the configured web origin so #137's page can read
    /// the email and the code Identity's <c>/resetPassword</c> requires.
    /// </remarks>
    /// <param name="to">The recipient.</param>
    /// <param name="resetCode">The reset code. Identity HTML-encodes it.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail PasswordResetCode(string to, string resetCode)
    {
        var code = WebUtility.HtmlDecode(resetCode);
        var link = resetLinks.Build(to, code);
        return this.PasswordResetMessage(to, link);
    }

    /// <summary>Composes the password-reset message from a link Identity generated.</summary>
    /// <remarks>
    /// Unreachable through <c>MapIdentityApi</c> as shipped (see <see cref="PasswordResetCode"/>).
    /// Implemented so the transport satisfies <c>IEmailSender&lt;TUser&gt;</c> in full (#138).
    /// </remarks>
    /// <param name="to">The recipient.</param>
    /// <param name="resetLink">The reset link. Identity HTML-encodes it.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail PasswordResetLink(string to, string resetLink) =>
        this.PasswordResetMessage(to, new Uri(WebUtility.HtmlDecode(resetLink)));

    /// <summary>
    /// Composes the notice sent when a registration is attempted for an address that already has a
    /// confirmed account. #147's non-enumeration guarantee: the API response stays a plain success,
    /// and the mailbox owner is the only one told what happened.
    /// </summary>
    /// <param name="to">The recipient.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail AlreadyRegistered(string to)
    {
        var body =
            "Someone tried to create a Cribstop account with this email address, and an account " +
            "for it already exists.\n\n" +
            "If this was you, sign in instead. If you forgot your password, use \"Forgot password?\" " +
            "on the sign-in page.\n\n" +
            "If you did not try to create an account, ignore this message.";
        return this.Compose(EmailKind.AlreadyRegistered, to, AlreadyRegisteredSubject, body);
    }

    /// <summary>Formats a token lifetime for the reader, e.g. "24 hours" or "1 hour".</summary>
    private static string FormatLifetime(TimeSpan lifetime)
    {
        if (lifetime.TotalDays >= 1)
        {
            var days = (int)Math.Round(lifetime.TotalDays);
            return days == 1 ? "1 day" : $"{days} days";
        }

        if (lifetime.TotalHours >= 1)
        {
            var hours = (int)Math.Round(lifetime.TotalHours);
            return hours == 1 ? "1 hour" : $"{hours} hours";
        }

        var minutes = Math.Max(1, (int)Math.Round(lifetime.TotalMinutes));
        return minutes == 1 ? "1 minute" : $"{minutes} minutes";
    }

    private OutboundEmail PasswordResetMessage(string to, Uri link)
    {
        var expiry = FormatLifetime(recovery.Value.TokenLifetime);
        var body =
            $"Open this link to reset your Cribstop password:\n\n{link}\n\n" +
            $"This link expires in {expiry}.\n\n{IgnoreIfNotReset}";
        return this.Compose(EmailKind.PasswordReset, to, ResetSubject, body);
    }

    private OutboundEmail Compose(EmailKind kind, string to, string subject, string body)
    {
        var sender = email.Value;
        return new OutboundEmail(
            kind,
            sender.FromName,
            sender.FromAddress,
            sender.ReplyToAddress,
            to,
            subject,
            $"{body}\n\n{sender.BrokerageDisclosure}");
    }
}
