// <copyright file="AppUserManager.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;

namespace AccountService.Models;

/// <summary>
/// Custom UserManager that automatically assigns the <see cref="Roles.User"/> role
/// whenever a new <see cref="ApplicationUser"/> account is created.
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

        if (result.Succeeded)
        {
            await AddToRoleAsync(user, Roles.User).ConfigureAwait(false);
        }

        return result;
    }
}
