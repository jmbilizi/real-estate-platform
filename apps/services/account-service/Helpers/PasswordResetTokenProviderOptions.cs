// <copyright file="PasswordResetTokenProviderOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Options for <see cref="PasswordResetTokenProvider"/>.
/// </summary>
/// <remarks>
/// A distinct options type is what makes a distinct lifetime possible. Identity's built-in
/// providers all resolve the single <see cref="DataProtectionTokenProviderOptions"/> instance, so
/// shortening the password-reset lifetime through it would also shorten email confirmation, email
/// change and two-factor tokens. <see cref="IOptions{TOptions}"/> is covariant, so this derived
/// type satisfies the base provider's constructor while carrying its own configured values.
/// </remarks>
internal sealed class PasswordResetTokenProviderOptions : DataProtectionTokenProviderOptions
{
}
