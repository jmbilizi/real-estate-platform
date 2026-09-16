// <copyright file="AppUserManager.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;

namespace AccountService.Models;

/// <summary>
/// Custom UserManager that automatically assigns the <see cref="Roles.User"/> role
/// whenever a new <see cref="ApplicationUser"/> account is created, and that carries this service's
/// two additions to Identity's password-reset behaviour.
/// </summary>
/// <remarks>
/// Password recovery runs on Identity's own <c>/account/forgotPassword</c> and
/// <c>/account/resetPassword</c> endpoints, so this is where behaviour the framework's handlers do
/// not provide has to attach. An endpoint filter cannot do it: it runs before the handler and
/// therefore before the account is even known.
/// </remarks>
internal sealed class AppUserManager(
    IUserStore<ApplicationUser> store,
    Microsoft.Extensions.Options.IOptions<IdentityOptions> optionsAccessor,
    IPasswordHasher<ApplicationUser> passwordHasher,
    IEnumerable<IUserValidator<ApplicationUser>> userValidators,
    IEnumerable<IPasswordValidator<ApplicationUser>> passwordValidators,
    ILookupNormalizer keyNormalizer,
    IdentityErrorDescriber errors,
    IServiceProvider services,
    ILogger<UserManager<ApplicationUser>> logger)
    : UserManager<ApplicationUser>(
        store,
        optionsAccessor,
        passwordHasher,
        userValidators,
        passwordValidators,
        keyNormalizer,
        errors,
        services,
        logger)
{
    /// <inheritdoc/>
    public override async Task<IdentityResult> CreateAsync(ApplicationUser user, string password)
    {
        var result = await base.CreateAsync(user, password).ConfigureAwait(false);

        if (result.Succeeded)
        {
            await AddToRoleAsync(user, Roles.User).ConfigureAwait(false);
        }

        return result;
    }

    /// <inheritdoc/>
    public override async Task<IdentityResult> CreateAsync(ApplicationUser user)
    {
        var result = await base.CreateAsync(user).ConfigureAwait(false);

        if (result.Succeeded)
        {
            await AddToRoleAsync(user, Roles.User).ConfigureAwait(false);
        }

        return result;
    }

    /// <summary>
    /// Reports a soft-deleted account as unconfirmed, so it is not recoverable through password
    /// reset and cannot be signed in to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This reads as an overloaded meaning for "email confirmed", and it is a deliberate one:
    /// <c>IsEmailConfirmedAsync</c> is the single predicate Identity consults on all three paths
    /// that matter here. <c>/forgotPassword</c> issues a token only
    /// <c>if (user is not null &amp;&amp; await userManager.IsEmailConfirmedAsync(user))</c>;
    /// <c>/resetPassword</c> returns its indistinguishable <c>InvalidToken</c> failure when the same
    /// check is false; and <c>SignInManager.CanSignInAsync</c> consults it when
    /// <c>SignInOptions.RequireConfirmedEmail</c> is on. Overriding it once therefore makes a
    /// soft-deleted account refuse recovery <em>and</em> say nothing about why — the same <c>200</c>
    /// as an address that never existed, and the same <c>400</c> as any other unusable token — which
    /// is the behaviour the service already promised. Every alternative seam
    /// (<c>IUserConfirmation</c>, a custom validator) is not on the paths Identity actually takes.
    /// </para>
    /// <para>
    /// Note what this does <em>not</em> fix: <c>/account/login</c> does not consult
    /// <c>IsEmailConfirmedAsync</c> at all unless <c>RequireConfirmedEmail</c> is on, so while that
    /// flag is off a soft-deleted account can still sign in with its existing password. That hole is
    /// pre-existing and service-wide, not something this ticket introduces, and it is filed
    /// separately rather than widened into scope here.
    /// </para>
    /// </remarks>
    /// <param name="user">The account to test.</param>
    /// <returns><see langword="true"/> when the address is confirmed and the account is live.</returns>
    public override async Task<bool> IsEmailConfirmedAsync(ApplicationUser user)
    {
        ArgumentNullException.ThrowIfNull(user);

        if (user.DeletedAt.HasValue)
        {
            return false;
        }

        return await base.IsEmailConfirmedAsync(user).ConfigureAwait(false);
    }

    /// <summary>
    /// Resets the password and releases any lockout on the account that was just reset.
    /// </summary>
    /// <remarks>
    /// Identity's <c>ResetPasswordAsync</c> writes the new hash but leaves <c>LockoutEnd</c> and
    /// <c>AccessFailedCount</c> alone, and <c>/account/login</c> signs in with
    /// <c>lockoutOnFailure: true</c>. Without this, the very password spraying that locks an account
    /// also outlasts the recovery from it: the owner resets successfully and is then refused, with
    /// no explanation, for the remainder of the lockout — which the attacker can simply re-trigger.
    /// </remarks>
    /// <param name="user">The account being recovered.</param>
    /// <param name="token">The reset token.</param>
    /// <param name="newPassword">The replacement password.</param>
    /// <returns>The result of the reset.</returns>
    public override async Task<IdentityResult> ResetPasswordAsync(
        ApplicationUser user,
        string token,
        string newPassword)
    {
        var result = await base.ResetPasswordAsync(user, token, newPassword).ConfigureAwait(false);

        if (result.Succeeded)
        {
            await this.ClearLockoutAsync(user).ConfigureAwait(false);
        }

        return result;
    }

    private async Task ClearLockoutAsync(ApplicationUser user)
    {
        await ResetAccessFailedCountAsync(user).ConfigureAwait(false);

        if (await GetLockoutEnabledAsync(user).ConfigureAwait(false))
        {
            await SetLockoutEndDateAsync(user, null).ConfigureAwait(false);
        }
    }
}
