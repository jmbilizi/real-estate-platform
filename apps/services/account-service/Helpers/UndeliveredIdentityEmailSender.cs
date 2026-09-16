// <copyright file="UndeliveredIdentityEmailSender.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>
/// The <see cref="IEmailSender{TUser}"/> used while no delivery channel is configured.
/// </summary>
/// <remarks>
/// <para>
/// It does not send anything, and it says so loudly. <b>What it replaces is worse than nothing.</b>
/// Identity's <c>AddApiEndpoints()</c> registers
/// <c>TryAddTransient(typeof(IEmailSender&lt;&gt;), typeof(DefaultMessageEmailSender&lt;&gt;))</c> over
/// <c>TryAddTransient&lt;IEmailSender, NoOpEmailSender&gt;()</c>, and
/// <c>NoOpEmailSender.SendEmailAsync</c> returns <c>Task.CompletedTask</c>. So a service that
/// registers neither — which this one did until now — discards every confirmation link and every
/// reset code with a <c>200</c>, no exception, and no log line at all. That is the exact failure
/// this service is being fixed to stop making, and it was happening on the registration path the
/// whole time.
/// </para>
/// <para>
/// A warning per message — distinguishable by <see cref="EventId"/> without matching on message
/// text — means the gap shows up in the service's own logs rather than in a consumer's empty inbox.
/// </para>
/// <para>
/// <b>The credential is never written to the log.</b> A confirmation link and a reset code are both
/// bearer credentials for the account: anything that reaches a shared log sink reaches everyone with
/// read access to that sink, which is a larger set than the account holder. The address is logged
/// because operating the service requires knowing which recovery attempts went nowhere.
/// </para>
/// <para>
/// Issue #138 replaces this class with a real sender on Postmark's transactional stream. That is one
/// DI registration: the endpoints, their contracts and their enumeration guarantees do not change,
/// because they are Identity's and this is the seam Identity already resolves.
/// </para>
/// </remarks>
/// <param name="logger">The logger.</param>
internal sealed class UndeliveredIdentityEmailSender(ILogger<UndeliveredIdentityEmailSender> logger)
    : IEmailSender<ApplicationUser>
{
    /// <summary>The log messages, held as constants so each call site stays a single line.</summary>
    private const string UndeliveredResetMessage =
        "Password reset token issued for {Email} but no delivery channel is configured; " +
        "the token was discarded and the account holder will receive nothing.";

    private const string UndeliveredConfirmationMessage =
        "Email confirmation link issued for {Email} but no delivery channel is configured; " +
        "the link was discarded and the address can never be confirmed through it.";

    /// <summary>The event ids, distinguishable in a log sink without matching on message text.</summary>
    private static readonly EventId UndeliveredResetEvent = new(1360, "PasswordResetTokenUndelivered");

    private static readonly EventId UndeliveredConfirmationEvent =
        new(1361, "EmailConfirmationLinkUndelivered");

    // Each template is written at its own call site rather than through a shared helper: CA2254
    // requires a logging template to be constant per call site, and it is right to — a varying
    // template is what defeats structured-log tooling downstream.
#pragma warning disable CA1848 // Use the LoggerMessage delegates — matches the convention at the service's other log sites.

    /// <inheritdoc/>
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink)
    {
        logger.LogWarning(UndeliveredConfirmationEvent, UndeliveredConfirmationMessage, email);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink)
    {
        logger.LogWarning(UndeliveredResetEvent, UndeliveredResetMessage, email);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode)
    {
        logger.LogWarning(UndeliveredResetEvent, UndeliveredResetMessage, email);
        return Task.CompletedTask;
    }

#pragma warning restore CA1848
}
