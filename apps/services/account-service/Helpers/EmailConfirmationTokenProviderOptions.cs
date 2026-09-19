// <copyright file="EmailConfirmationTokenProviderOptions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Identity;

namespace AccountService.Helpers;

/// <summary>
/// Options for <see cref="EmailConfirmationTokenProvider"/>. A distinct type gives the
/// confirmation token its own lifetime. Identity's built-in providers all share one
/// <see cref="DataProtectionTokenProviderOptions"/> instance.
/// </summary>
internal sealed class EmailConfirmationTokenProviderOptions : DataProtectionTokenProviderOptions
{
}
