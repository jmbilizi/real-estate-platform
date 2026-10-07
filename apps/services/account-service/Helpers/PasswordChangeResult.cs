// <copyright file="PasswordChangeResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>The result of <see cref="PasswordChangeService.ChangeAsync"/>.</summary>
/// <param name="Status">The outcome.</param>
/// <param name="Errors">The policy errors as code and description, for <see cref="PasswordChangeStatus.PasswordRejected"/>.</param>
/// <param name="RetryAfterSeconds">How long the lock lasts, for <see cref="PasswordChangeStatus.Limited"/>.</param>
/// <param name="User">The changed account, for <see cref="PasswordChangeStatus.Changed"/>.</param>
internal sealed record PasswordChangeResult(
    PasswordChangeStatus Status,
    IReadOnlyDictionary<string, string>? Errors = null,
    int? RetryAfterSeconds = null,
    ApplicationUser? User = null);
