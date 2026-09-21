// <copyright file="PostmarkEmailSender.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>
/// The <see cref="IEmailSender{TUser}"/> registered for Identity's three canonical sends.
/// </summary>
/// <remarks>
/// A thin adapter: composes through <see cref="IdentityEmailComposer"/> and hands the result to
/// <see cref="IOutboundEmailSender"/>, the same seam <see cref="IdentityResponseShapingFilter"/>
/// uses for the already-registered notice. No second delivery path (#138).
/// </remarks>
/// <param name="composer">The message composer.</param>
/// <param name="outbound">The delivery seam.</param>
internal sealed class PostmarkEmailSender(IdentityEmailComposer composer, IOutboundEmailSender outbound)
    : IEmailSender<ApplicationUser>
{
    /// <inheritdoc/>
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        outbound.SendAsync(composer.ConfirmationLink(email, confirmationLink));

    /// <inheritdoc/>
    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        outbound.SendAsync(composer.PasswordResetLink(email, resetLink));

    /// <inheritdoc/>
    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        outbound.SendAsync(composer.PasswordResetCode(email, resetCode));
}
