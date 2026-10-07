// <copyright file="IdentifyResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The result of an identify call. It never carries the email.</summary>
/// <param name="Status">What happened.</param>
/// <param name="Next">The route, for <c>Ok</c>.</param>
/// <param name="ResendAfterSeconds">The seconds until the next code. Zero for the password route.</param>
/// <param name="ExpiresInSeconds">The life of the code. Zero for the password route.</param>
internal sealed record IdentifyResult(
    IdentifyStatus Status,
    IdentifyNext Next = IdentifyNext.Code,
    int ResendAfterSeconds = 0,
    int ExpiresInSeconds = 0);
