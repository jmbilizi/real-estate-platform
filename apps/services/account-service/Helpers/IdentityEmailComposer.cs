// <copyright file="IdentityEmailComposer.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Composes every transactional message this service sends: the one-time code, the
/// already-registered notice, and the security notices.
/// </summary>
/// <remarks>
/// Every sender composes through this class. It is the one place the sender identity and the links
/// are applied. Every body ends with the configured brokerage disclosure (PRD §6 brand prominence).
/// </remarks>
/// <param name="email">The sender identity.</param>
internal sealed class IdentityEmailComposer(IOptions<TransactionalEmailOptions> email)
{
    private const string AlreadyRegisteredSubject = "Someone tried to create a Cribstop account with your email address";

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

    /// <summary>Composes the one-time code message. The code is the only sensitive content.</summary>
    /// <param name="to">The recipient.</param>
    /// <param name="code">The code, digits only, so a mail client can offer to autofill it.</param>
    /// <param name="lifetime">How long the code works.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail Code(string to, string code, TimeSpan lifetime)
    {
        var body =
            $"Your Cribstop code:\n\n{code}\n\n" +
            $"It expires in {FormatLifetime(lifetime)}.\n\n" +
            "Not you? Ignore this message.";
        return this.Compose(EmailKind.Code, to, $"{code} is your Cribstop code", body);
    }

    /// <summary>Composes the notice sent to the old address after an email change.</summary>
    /// <param name="to">The old address.</param>
    /// <param name="maskedNewEmail">The new address with the middle masked.</param>
    /// <param name="when">When the change happened, in UTC.</param>
    /// <param name="secureLink">The "This wasn't me" link.</param>
    /// <param name="linkLifetime">How long the link works.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail EmailChangedNotice(string to, string maskedNewEmail, DateTime when, Uri secureLink, TimeSpan linkLifetime)
    {
        var body =
            $"The email address on your Cribstop account changed to {maskedNewEmail}.\n\n" +
            $"When: {FormatTime(when)}.\n\n" +
            "If you made this change, you do not need to do anything.\n\n" +
            this.NotMeSection(secureLink, linkLifetime);
        return this.Compose(EmailKind.EmailChangedNotice, to, "Your Cribstop email address changed", body);
    }

    /// <summary>Composes the notice sent after a password change or reset.</summary>
    /// <param name="to">The account address.</param>
    /// <param name="reset"><see langword="true"/> for a reset, <see langword="false"/> for a change.</param>
    /// <param name="when">When the change happened, in UTC.</param>
    /// <param name="secureLink">The "This wasn't me" link.</param>
    /// <param name="linkLifetime">How long the link works.</param>
    /// <returns>The message.</returns>
    internal OutboundEmail PasswordChangedNotice(string to, bool reset, DateTime when, Uri secureLink, TimeSpan linkLifetime)
    {
        var what = reset ? "was reset" : "changed";
        var body =
            $"The password on your Cribstop account {what}.\n\n" +
            $"When: {FormatTime(when)}.\n\n" +
            "If you made this change, you do not need to do anything.\n\n" +
            this.NotMeSection(secureLink, linkLifetime);
        return this.Compose(EmailKind.PasswordChangedNotice, to, $"Your Cribstop password {what}", body);
    }

    /// <summary>Formats a time for the notices, e.g. "October 7, 2026 at 14:05 UTC".</summary>
    private static string FormatTime(DateTime when) =>
        when.ToUniversalTime().ToString("MMMM d, yyyy 'at' HH:mm 'UTC'", System.Globalization.CultureInfo.InvariantCulture);

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

    private string NotMeSection(Uri secureLink, TimeSpan linkLifetime) =>
        $"If this was not you, open this link to secure your account:\n\n{secureLink}\n\n" +
        $"The link works once and expires in {FormatLifetime(linkLifetime)}. " +
        $"If the link does not work, reply to this message at {email.Value.ReplyToAddress}.";

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
