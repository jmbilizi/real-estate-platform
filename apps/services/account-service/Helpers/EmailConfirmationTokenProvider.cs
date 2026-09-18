// <copyright file="EmailConfirmationTokenProvider.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Token provider dedicated to email confirmation. Its name is also the data-protection purpose,
/// so a confirmation token cannot be replayed as any other Identity token.
/// </summary>
/// <param name="dataProtectionProvider">The data protection provider.</param>
/// <param name="options">The provider options.</param>
/// <param name="logger">The logger used by the base provider.</param>
internal sealed class EmailConfirmationTokenProvider(
    IDataProtectionProvider dataProtectionProvider,
    IOptions<EmailConfirmationTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<ApplicationUser>> logger)
    : DataProtectorTokenProvider<ApplicationUser>(dataProtectionProvider, options, logger)
{
    /// <summary>The name registered with Identity and set on <c>IdentityOptions.Tokens.EmailConfirmationTokenProvider</c>.</summary>
    internal const string ProviderName = "CribstopEmailConfirmation";
}
