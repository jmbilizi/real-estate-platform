// <copyright file="SignUpResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of a sign-up step. It never carries the email or the code.</summary>
/// <param name="Status">What happened.</param>
/// <param name="RetryAfterSeconds">For <c>Limited</c>, the whole seconds to wait.</param>
/// <param name="ResendAfterSeconds">For <c>Ok</c>, the seconds until the next code.</param>
/// <param name="ExpiresInSeconds">For <c>Ok</c>, the life of the code. For <c>Verified</c>, the life of the proof.</param>
/// <param name="AttemptsLeft">For <c>WrongCode</c>, the wrong tries left before the lock.</param>
/// <param name="Proof">For <c>Verified</c>, the one-time sign-up proof.</param>
internal sealed record SignUpResult(
    SignUpStatus Status,
    int RetryAfterSeconds = 0,
    int ResendAfterSeconds = 0,
    int ExpiresInSeconds = 0,
    int AttemptsLeft = 0,
    string? Proof = null);
