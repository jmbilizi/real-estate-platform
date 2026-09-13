// <copyright file="PasswordResetTokenProvider.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Data-protection token provider dedicated to password reset, with its own lifetime and its own
/// protection purpose.
/// </summary>
/// <remarks>
/// The distinct <see cref="DataProtectionTokenProviderOptions.Name"/> is the data-protection
/// purpose string, so a token minted here cannot be replayed against any other Identity token
/// purpose, and vice versa.
/// </remarks>
/// <param name="dataProtectionProvider">The data protection provider.</param>
/// <param name="options">The password-reset token provider options.</param>
/// <param name="logger">The logger used by the base provider.</param>
internal sealed class PasswordResetTokenProvider(
    IDataProtectionProvider dataProtectionProvider,
    IOptions<PasswordResetTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<ApplicationUser>> logger)
    : DataProtectorTokenProvider<ApplicationUser>(dataProtectionProvider, options, logger)
{
    /// <summary>
    /// The provider name registered with Identity and referenced by
    /// <c>IdentityOptions.Tokens.PasswordResetTokenProvider</c>.
    /// </summary>
    internal const string ProviderName = "CribstopPasswordReset";
}
