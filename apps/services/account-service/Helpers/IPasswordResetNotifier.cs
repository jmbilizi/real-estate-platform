// <copyright file="IPasswordResetNotifier.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// Delivers an issued password-reset token to the account holder.
/// </summary>
/// <remarks>
/// <para>
/// This is the seam the delivery story plugs into: the endpoint issues the token and hands it here,
/// and nothing above this interface knows or cares how it travels. Supplying a real implementation
/// is a change to one DI registration, not to the API — the request and confirm contracts, the
/// status codes and the enumeration guarantees all stay exactly as they are.
/// </para>
/// <para>
/// The reset mail belongs on a transactional sending stream. Account recovery must never queue
/// behind, or inherit the sending reputation of, a broadcast/marketing stream.
/// </para>
/// </remarks>
internal interface IPasswordResetNotifier
{
    /// <summary>
    /// Delivers a reset token to the given address.
    /// </summary>
    /// <param name="email">The account's email address.</param>
    /// <param name="resetCode">The URL-safe reset code to embed in the reset link.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>A task that completes when delivery has been accepted or recorded as unavailable.</returns>
    Task SendPasswordResetAsync(string email, string resetCode, CancellationToken cancellationToken);
}
