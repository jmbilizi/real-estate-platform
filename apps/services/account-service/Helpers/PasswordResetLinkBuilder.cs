// <copyright file="PasswordResetLinkBuilder.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Builds the password-reset link a consumer clicks: the configured web origin plus the
/// configured reset path, carrying the email address and the reset code.
/// </summary>
/// <remarks>
/// Unlike <see cref="ConfirmationLinkBuilder"/>, this never rebuilds an Identity-generated link.
/// <c>MapIdentityApi</c>'s <c>/forgotPassword</c> endpoint always calls
/// <c>IEmailSender.SendPasswordResetCodeAsync</c> with a bare code, never a URL, so the link this
/// service sends is built here from scratch, carrying both the email and the code because
/// Identity's <c>/resetPassword</c> is keyed on both (#137, #138).
/// </remarks>
/// <param name="options">The account-recovery options.</param>
internal sealed class PasswordResetLinkBuilder(IOptions<AccountRecoveryOptions> options)
{
    /// <summary>Builds a password-reset link for the given address and code.</summary>
    /// <param name="email">The address the code was issued for.</param>
    /// <param name="code">The reset code, already HTML-decoded.</param>
    /// <returns>The absolute link.</returns>
    internal Uri Build(string email, string code)
    {
        var settings = options.Value;
        var origin = settings.WebBaseUrl ?? throw new InvalidOperationException(
            $"{AccountRecoveryOptions.SectionName}:{nameof(settings.WebBaseUrl)} is not configured.");

        var query = new Dictionary<string, string?>
        {
            ["email"] = email,
            ["code"] = code,
        };

        var target = new Uri(origin, settings.PasswordResetPath);
        return new Uri(QueryHelpers.AddQueryString(target.GetLeftPart(UriPartial.Path), query));
    }
}
