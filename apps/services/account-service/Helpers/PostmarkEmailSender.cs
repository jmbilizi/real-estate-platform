// <copyright file="PostmarkEmailSender.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>
/// The <see cref="IEmailSender{TUser}"/> that <c>MapIdentityApi</c> requires.
/// </summary>
/// <remarks>
/// Every Identity send is a link or a bare code, and this service sends neither. Account flows send
/// a code through <see cref="IOutboundEmailSender"/>. Each member throws, so a stray Identity call
/// fails loudly and sends nothing.
/// </remarks>
internal sealed class PostmarkEmailSender : IEmailSender<ApplicationUser>
{
    /// <inheritdoc/>
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        throw new NotSupportedException("Confirmation links are retired. Only a verified code creates an account.");

    /// <inheritdoc/>
    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        throw new NotSupportedException("Reset links are retired. Password reset runs on codes.");

    /// <inheritdoc/>
    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        throw new NotSupportedException("Reset codes from Identity are retired. Password reset runs on /account/password/reset.");
}
