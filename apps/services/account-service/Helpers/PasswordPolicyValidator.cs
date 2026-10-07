// <copyright file="PasswordPolicyValidator.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The only password validator. It replaces Identity's stock composition rules with a length range
/// and the breached-password check. The error <c>Code</c> and <c>Description</c> are the same
/// stable code, so the web app writes its own copy: <c>too_short</c>, <c>too_long</c>,
/// <c>breached</c>.
/// </summary>
/// <remarks>
/// The password is not trimmed or truncated. Length counts UTF-16 code units, as Identity does.
/// Every Identity path that sets a password runs this: sign-up, register, change and reset.
/// </remarks>
/// <param name="options">The policy options.</param>
/// <param name="breaches">The breach client.</param>
internal sealed class PasswordPolicyValidator(
    IOptions<PasswordPolicyOptions> options,
    IPwnedPasswordsClient breaches) : IPasswordValidator<ApplicationUser>
{
    /// <summary>The code for a password under the minimum length.</summary>
    internal const string TooShort = "too_short";

    /// <summary>The code for a password over the maximum length.</summary>
    internal const string TooLong = "too_long";

    /// <summary>The code for a password found in a known breach.</summary>
    internal const string Breached = "breached";

    /// <inheritdoc/>
    public async Task<IdentityResult> ValidateAsync(UserManager<ApplicationUser> manager, ApplicationUser user, string? password)
    {
        var settings = options.Value;
        if ((password?.Length ?? 0) < settings.MinLength)
        {
            return Fail(TooShort);
        }

        if (password!.Length > settings.MaxLength)
        {
            return Fail(TooLong);
        }

        if (settings.BreachCheckEnabled && await breaches.IsBreachedAsync(password).ConfigureAwait(false) == true)
        {
            return Fail(Breached);
        }

        return IdentityResult.Success;
    }

    private static IdentityResult Fail(string code) =>
        IdentityResult.Failed(new IdentityError { Code = code, Description = code });
}
