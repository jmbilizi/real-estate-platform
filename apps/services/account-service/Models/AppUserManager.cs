// <copyright file="AppUserManager.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;

namespace AccountService.Models;

/// <summary>
/// Custom UserManager that assigns the <see cref="Roles.User"/> role whenever a new
/// <see cref="ApplicationUser"/> account is created, and that hides soft-deleted accounts from
/// email-confirmation checks.
/// </summary>
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

        // A failed role grant is a failed create. Sign-up completion rolls back on it.
        return result.Succeeded
            ? await AddToRoleAsync(user, Roles.User).ConfigureAwait(false)
            : result;
    }

    /// <summary>
    /// Reports a soft-deleted account as unconfirmed, so it cannot be signed in to through Identity.
    /// </summary>
    /// <remarks>
    /// <c>IsEmailConfirmedAsync</c> is the one predicate Identity consults, so one override covers
    /// every path that uses it. <c>AppSignInManager.CanSignInAsync</c> also refuses a soft-deleted
    /// account on its own, so the refusal holds while <c>RequireConfirmedAccount</c> is off (#152).
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

    /// <summary>Releases the lockout of an account after a successful password reset.</summary>
    /// <param name="user">The account that was reset.</param>
    /// <returns>A task that completes when the lockout is released.</returns>
    internal async Task ClearLockoutAsync(ApplicationUser user)
    {
        // Both results are checked rather than discarded. Neither call is expected to fail here,
        // but a validator-driven UpdateUserAsync failure would leave the account still locked after
        // a reset the consumer was told succeeded — and their next move is to try logging in and be
        // refused with no explanation. Silent is the one thing that must not happen.
        var reset = await ResetAccessFailedCountAsync(user).ConfigureAwait(false);
        WarnIfFailed(reset, user, nameof(ResetAccessFailedCountAsync));

        if (await GetLockoutEnabledAsync(user).ConfigureAwait(false))
        {
            var cleared = await SetLockoutEndDateAsync(user, null).ConfigureAwait(false);
            WarnIfFailed(cleared, user, nameof(SetLockoutEndDateAsync));
        }
    }

    private void WarnIfFailed(IdentityResult result, ApplicationUser user, string operation)
    {
        if (result.Succeeded)
        {
            return;
        }

#pragma warning disable CA1848 // Use the LoggerMessage delegates — matches the convention at the service's other log sites.
        Logger.LogWarning(
            "{Operation} failed for {UserId} after a successful password reset; the account may still be locked out. Errors: {Errors}",
            operation,
            user.Id,
            string.Join("; ", result.Errors.Select(error => error.Code)));
#pragma warning restore CA1848
    }
}
