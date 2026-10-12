// <copyright file="CodeSendOutcomeWire.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The wire names of <see cref="CodeSendOutcome"/>.</summary>
internal static class CodeSendOutcomeWire
{
    /// <summary>Gets the snake_case name the API sends, or null for <see cref="CodeSendOutcome.Sent"/>.</summary>
    /// <param name="outcome">The outcome.</param>
    /// <returns>The reason, or null.</returns>
    internal static string? Reason(this CodeSendOutcome outcome) => outcome switch
    {
        CodeSendOutcome.Sent => null,
        CodeSendOutcome.Cooldown => "cooldown",
        CodeSendOutcome.HourlyCap => "hourly_cap",
        CodeSendOutcome.DailyCap => "daily_cap",
        CodeSendOutcome.NetworkCap => "network_cap",
        CodeSendOutcome.Locked => "locked",
        CodeSendOutcome.Pending => "pending",
        CodeSendOutcome.Notice => "notice",
        _ => "unknown",
    };

    /// <summary>Maps a refused limiter counter to an outcome.</summary>
    /// <param name="counter">The counter kind: <c>addr</c>, <c>interval</c>, <c>hour</c> or <c>day</c>.</param>
    /// <returns>The outcome.</returns>
    internal static CodeSendOutcome FromCounter(string? counter) => counter switch
    {
        "interval" => CodeSendOutcome.Cooldown,
        "hour" => CodeSendOutcome.HourlyCap,
        "day" => CodeSendOutcome.DailyCap,
        _ => CodeSendOutcome.NetworkCap,
    };
}
