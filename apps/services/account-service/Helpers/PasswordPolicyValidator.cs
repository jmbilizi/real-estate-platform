// <copyright file="PasswordPolicyValidator.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text;
using AccountService.Configuration;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The only password validator. It replaces Identity's stock composition rules with the either/or
/// rule: <see cref="PasswordPolicyOptions.MinLength"/> characters with every class, or
/// <see cref="PasswordPolicyOptions.PassphraseLength"/> characters with none. The breached-password
/// check follows. The error <c>Code</c> and <c>Description</c> are the same stable code, so the web
/// app writes its own copy: <c>too_short</c>, <c>missing_upper</c>, <c>missing_lower</c>,
/// <c>missing_digit</c>, <c>missing_symbol</c>, <c>too_long</c>, <c>breached</c>.
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

    /// <summary>The code for a password with no uppercase letter.</summary>
    internal const string MissingUpper = "missing_upper";

    /// <summary>The code for a password with no lowercase letter.</summary>
    internal const string MissingLower = "missing_lower";

    /// <summary>The code for a password with no number.</summary>
    internal const string MissingDigit = "missing_digit";

    /// <summary>The code for a password with no symbol.</summary>
    internal const string MissingSymbol = "missing_symbol";

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

        if (password.Length < settings.PassphraseLength)
        {
            var missing = new List<string>(4);
            var runes = password.EnumerateRunes().ToArray();
            if (!runes.Any(Rune.IsUpper))
            {
                missing.Add(MissingUpper);
            }

            if (!runes.Any(Rune.IsLower))
            {
                missing.Add(MissingLower);
            }

            if (!runes.Any(Rune.IsDigit))
            {
                missing.Add(MissingDigit);
            }

            if (!runes.Any(r => !Rune.IsLetterOrDigit(r)))
            {
                missing.Add(MissingSymbol);
            }

            if (missing.Count > 0)
            {
                return Fail([.. missing]);
            }
        }

        if (settings.BreachCheckEnabled && await breaches.IsBreachedAsync(password).ConfigureAwait(false) == true)
        {
            return Fail(Breached);
        }

        return IdentityResult.Success;
    }

    private static IdentityResult Fail(params string[] codes) =>
        IdentityResult.Failed([.. codes.Select(code => new IdentityError { Code = code, Description = code })]);
}
