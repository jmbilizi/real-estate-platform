// <copyright file="SignUpCompleteResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>The result of the complete step.</summary>
/// <param name="Status">What happened.</param>
/// <param name="User">For <c>Created</c>, the new account.</param>
/// <param name="Errors">For <c>PasswordRejected</c>, the stable error codes.</param>
internal sealed record SignUpCompleteResult(
    SignUpCompleteStatus Status,
    ApplicationUser? User = null,
    IReadOnlyList<string>? Errors = null);
