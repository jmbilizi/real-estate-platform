// <copyright file="EmailCodeVerifyResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of verifying a code.</summary>
/// <param name="Status">What happened.</param>
/// <param name="RetryAfterSeconds">For <c>Locked</c>, the whole seconds until the lock ends.</param>
/// <param name="UserId">For <c>Verified</c>, the account id stored with the code, if any.</param>
internal sealed record EmailCodeVerifyResult(EmailCodeVerifyStatus Status, int RetryAfterSeconds = 0, string? UserId = null);
