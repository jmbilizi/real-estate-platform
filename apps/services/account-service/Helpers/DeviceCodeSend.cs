// <copyright file="DeviceCodeSend.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>What a request for a new-device code did.</summary>
/// <param name="Status">The engine status.</param>
/// <param name="ResendAfterSeconds">Seconds until the next code can send.</param>
/// <param name="ExpiresInSeconds">Seconds the open code lives, or 0 when none was sent.</param>
/// <param name="Reason">Why no code was sent (#813), or null when one was.</param>
internal sealed record DeviceCodeSend(
    EmailCodeIssueStatus Status,
    int ResendAfterSeconds,
    int ExpiresInSeconds,
    string? Reason);
