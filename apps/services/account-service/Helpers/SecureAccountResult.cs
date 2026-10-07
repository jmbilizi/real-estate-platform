// <copyright file="SecureAccountResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of <see cref="SecureAccountService.SecureAsync"/>.</summary>
/// <param name="Secured"><see langword="true"/> when the token worked and the account is secured.</param>
/// <param name="EmailRestored"><see langword="true"/> when the old email address came back.</param>
internal sealed record SecureAccountResult(bool Secured, bool EmailRestored = false);
