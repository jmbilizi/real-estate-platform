// <copyright file="IOutboundEmailSender.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>
/// The one delivery seam every composed message goes through: Identity's three canonical sends
/// (via <see cref="PostmarkEmailSender"/>) and every other transactional message this service
/// composes (#138). There is no second delivery path.
/// </summary>
internal interface IOutboundEmailSender
{
    /// <summary>Hands a composed message to the transport. Returns once the message is queued.</summary>
    /// <param name="message">The message.</param>
    /// <param name="cancellationToken">A token to cancel the enqueue.</param>
    /// <returns>A task that completes once the message is queued, not once it is delivered.</returns>
    Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default);
}
