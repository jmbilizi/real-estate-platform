// <copyright file="BearerStampCheck.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Revokes an <c>Identity.Bearer</c> access token whose account rotated its security stamp (#142).
/// </summary>
/// <remarks>
/// <c>BearerTokenHandler</c> is internal and has no principal-validation event, so the check runs
/// from <c>OnMessageReceived</c>. It uses <see cref="SignInManager{TUser}.ValidateSecurityStampAsync(System.Security.Claims.ClaimsPrincipal)"/>,
/// the call <see cref="CredentialIntrospector"/> makes. Cost: one user read per bearer request.
/// An expired or malformed token is left to the handler, which rejects it itself.
/// </remarks>
internal static class BearerStampCheck
{
    /// <summary>
    /// Fails the message when the token's security stamp no longer matches the stored one.
    /// </summary>
    /// <param name="context">The bearer message context, with <c>Token</c> already set.</param>
    /// <returns>A task that completes when the check is done.</returns>
    internal static async Task RejectRevokedAsync(MessageReceivedContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (string.IsNullOrEmpty(context.Token))
        {
            return;
        }

        var protector = context.HttpContext.RequestServices
            .GetRequiredService<IOptionsMonitor<BearerTokenOptions>>()
            .Get(context.Scheme.Name)
            .BearerTokenProtector;

        var principal = protector.Unprotect(context.Token)?.Principal;
        if (principal is null)
        {
            return;
        }

        var signInManager = context.HttpContext.RequestServices
            .GetRequiredService<SignInManager<ApplicationUser>>();
        if (await signInManager.ValidateSecurityStampAsync(principal).ConfigureAwait(false) is null)
        {
            context.Fail("The security stamp of the bearer token is no longer valid.");
        }
    }
}
