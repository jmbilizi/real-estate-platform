// <copyright file="PasswordResetCompleteResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of the reset complete step.</summary>
/// <param name="Status">What happened.</param>
/// <param name="Errors">For <c>PasswordRejected</c>, the stable error codes.</param>
internal sealed record PasswordResetCompleteResult(
    PasswordResetCompleteStatus Status,
    IReadOnlyList<string>? Errors = null);
