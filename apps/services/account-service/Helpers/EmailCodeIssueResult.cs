// <copyright file="EmailCodeIssueResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of issuing a code. It never carries the code.</summary>
/// <param name="Status">What happened.</param>
/// <param name="RetryAfterSeconds">For <c>Throttled</c> and <c>Locked</c>, the whole seconds to wait.</param>
internal sealed record EmailCodeIssueResult(EmailCodeIssueStatus Status, int RetryAfterSeconds = 0);
