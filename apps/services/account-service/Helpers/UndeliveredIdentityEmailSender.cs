// <copyright file="UndeliveredIdentityEmailSender.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>
/// The <see cref="IEmailSender{TUser}"/> registered while no delivery transport exists.
/// </summary>
/// <remarks>
/// <para>
/// It sends nothing and logs one <c>Warning</c> per message, with an event id per message kind.
/// Identity's fallback (<c>NoOpEmailSender</c>) discards every message with a 200 and no log line,
/// which is what this service did before #147.
/// </para>
/// <para>
/// The body is never logged. A confirmation link and a reset code are bearer credentials for the
/// account. #138 replaces this class with the Postmark transport. The composer stays.
/// </para>
/// </remarks>
/// <param name="composer">The message composer.</param>
/// <param name="logger">The logger.</param>
internal sealed class UndeliveredIdentityEmailSender(
    IdentityEmailComposer composer,
    ILogger<UndeliveredIdentityEmailSender> logger)
    : IEmailSender<ApplicationUser>
{
    internal static readonly EventId UndeliveredResetEvent = new(1360, "PasswordResetMessageUndelivered");

    internal static readonly EventId UndeliveredConfirmationEvent = new(1361, "EmailConfirmationLinkUndelivered");

    private const string UndeliveredMessage =
        "{Kind} for {To} from {FromName} <{FromAddress}> (reply-to {ReplyTo}) was composed but no " +
        "delivery channel is configured; the message was discarded.";

    /// <inheritdoc/>
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink)
    {
        this.Discard(UndeliveredConfirmationEvent, "Email confirmation link", composer.ConfirmationLink(email, confirmationLink));
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink)
    {
        this.Discard(UndeliveredResetEvent, "Password reset link", composer.PasswordResetLink(email, resetLink));
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode)
    {
        this.Discard(UndeliveredResetEvent, "Password reset code", composer.PasswordResetCode(email, resetCode));
        return Task.CompletedTask;
    }

#pragma warning disable CA1848 // LoggerMessage delegates: matches the service's other log sites.
    private void Discard(EventId eventId, string kind, OutboundEmail message) =>
        logger.LogWarning(
            eventId,
            UndeliveredMessage,
            kind,
            message.To,
            message.FromName,
            message.FromAddress,
            message.ReplyToAddress);
#pragma warning restore CA1848
}
