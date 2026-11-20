// <copyright file="GoogleSignInService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Resolves a Google ID token to an account (#1049). A Google address with <c>email_verified</c>
/// is the second verified path that creates an account, after the sign-up code.
/// </summary>
/// <remarks>
/// Lookup order: the Google <c>sub</c> first, then the verified address. A match by address links
/// the Google login. A soft-deleted or locked account is refused before any link or session.
/// Nothing here logs the token, the address or the <c>sub</c>.
/// </remarks>
/// <param name="validator">The token validator.</param>
/// <param name="users">The user manager.</param>
/// <param name="signInManager">The sign-in manager. Its <c>CanSignInAsync</c> refuses a soft-deleted account.</param>
/// <param name="options">The Google options.</param>
internal sealed class GoogleSignInService(
    IGoogleIdTokenValidator validator,
    AppUserManager users,
    SignInManager<ApplicationUser> signInManager,
    IOptions<GoogleSignInOptions> options)
{
    /// <summary>The Identity login provider name stored for a Google link.</summary>
    internal const string Provider = "Google";

    /// <summary>Signs a caller in with a Google ID token.</summary>
    /// <param name="credential">The ID token.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The outcome.</returns>
    internal async Task<GoogleSignInResult> SignInAsync(string? credential, CancellationToken cancellationToken = default)
    {
        var settings = options.Value;
        if (!settings.IsConfigured)
        {
            return new GoogleSignInResult(GoogleSignInStatus.NotConfigured);
        }

        if (string.IsNullOrWhiteSpace(credential))
        {
            return new GoogleSignInResult(GoogleSignInStatus.InvalidToken);
        }

        var identity = await validator.ValidateAsync(credential, settings.ClientId, cancellationToken).ConfigureAwait(false);
        if (identity is null)
        {
            return new GoogleSignInResult(GoogleSignInStatus.InvalidToken);
        }

        if (!identity.EmailVerified)
        {
            return new GoogleSignInResult(GoogleSignInStatus.EmailNotVerified);
        }

        if (!SignUpEmail.TryNormalize(identity.Email, out _, out var email))
        {
            return new GoogleSignInResult(GoogleSignInStatus.InvalidToken);
        }

        var user = await users.FindByLoginAsync(Provider, identity.Subject).ConfigureAwait(false);
        var created = false;

        if (user is null)
        {
            user = await users.FindByEmailAsync(email).ConfigureAwait(false);
            if (user is not null)
            {
                if (!await this.CanSignInAsync(user).ConfigureAwait(false))
                {
                    return new GoogleSignInResult(GoogleSignInStatus.Refused);
                }

                await this.LinkAsync(user, identity).ConfigureAwait(false);
            }
            else
            {
                var account = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true };
                var result = await users.CreateAsync(account).ConfigureAwait(false);
                if (result.Succeeded)
                {
                    user = account;
                    created = true;
                }
                else
                {
                    // A parallel request may have created the address. Anything else is a fault.
                    user = await users.FindByEmailAsync(email).ConfigureAwait(false)
                        ?? throw new InvalidOperationException(
                            "The account was not created: " + string.Join(", ", result.Errors.Select(e => e.Code)));
                }

                await this.LinkAsync(user, identity).ConfigureAwait(false);
            }
        }

        return await this.CanSignInAsync(user).ConfigureAwait(false)
            ? new GoogleSignInResult(GoogleSignInStatus.SignedIn, user, created)
            : new GoogleSignInResult(GoogleSignInStatus.Refused);
    }

    private async Task<bool> CanSignInAsync(ApplicationUser user) =>
        await signInManager.CanSignInAsync(user).ConfigureAwait(false)
        && !await users.IsLockedOutAsync(user).ConfigureAwait(false);

    private async Task LinkAsync(ApplicationUser user, GoogleIdentity identity)
    {
        var logins = await users.GetLoginsAsync(user).ConfigureAwait(false);
        if (logins.Any(l => l.LoginProvider == Provider && l.ProviderKey == identity.Subject))
        {
            return;
        }

        // A failed link is not a failed sign-in. The next call matches by address again.
        await users.AddLoginAsync(user, new UserLoginInfo(Provider, identity.Subject, Provider)).ConfigureAwait(false);
    }
}
