// <copyright file="UndeliveredPasswordResetNotifier.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// The <see cref="IPasswordResetNotifier"/> used while no delivery channel is configured.
/// </summary>
/// <remarks>
/// <para>
/// It does not send anything, and it says so loudly. The failure this guards against is the one
/// that is already in the product: a reset flow that looks successful from the outside while no
/// mail exists. A warning on every issued token — distinguishable by message and by
/// <c>EventId</c> — means the gap shows up in the service's own logs rather than in a consumer's
/// empty inbox.
/// </para>
/// <para>
/// The token is never written to the log. It is a bearer credential for the account: anything that
/// reaches a shared log sink reaches everyone with read access to that sink, which is a larger set
/// than the account holder. The address is logged because operating the service requires knowing
/// which recovery attempts went nowhere.
/// </para>
/// </remarks>
/// <param name="logger">The logger.</param>
internal sealed class UndeliveredPasswordResetNotifier(ILogger<UndeliveredPasswordResetNotifier> logger)
    : IPasswordResetNotifier
{
    /// <summary>The log message, held as a constant so the call site stays a single line.</summary>
    private const string UndeliveredMessage =
        "Password reset token issued for {Email} but no delivery channel is configured; " +
        "the token was discarded and the account holder will receive nothing.";

    /// <summary>The event id, distinguishable in a log sink without matching on message text.</summary>
    private static readonly EventId UndeliveredEvent = new(1360, "PasswordResetTokenUndelivered");

    /// <inheritdoc/>
    public Task SendPasswordResetAsync(string email, string resetCode, CancellationToken cancellationToken)
    {
#pragma warning disable CA1848 // Use the LoggerMessage delegates — matches the convention at the service's other log sites.
        logger.LogWarning(UndeliveredEvent, UndeliveredMessage, email);
#pragma warning restore CA1848

        return Task.CompletedTask;
    }
}
