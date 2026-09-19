// <copyright file="WaitlistInterestKinds.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Fixed vocabulary of early-access interests. Services and Connect ship as gated preview, so an
/// account registers interest per pillar and the client renders joined-state from it.
/// <para>
/// An account may hold any combination of these at the same time. They are independent signals, not
/// a persona — nothing collapses them to one value, and nothing gates a capability on them
/// (PRD §11.2). Interest is the complete payload: no protected-class or eligibility signal is
/// collected with it (PRD §6).
/// </para>
/// </summary>
internal static class WaitlistInterestKinds
{
    /// <summary>The account wants to find and hire providers when Services opens.</summary>
    public const string ServicesConsumer = "services-consumer";

    /// <summary>The account wants to offer services when Services opens.</summary>
    public const string ServicesProvider = "services-provider";

    /// <summary>The account wants access to the Connect community when it opens.</summary>
    public const string Connect = "connect";

    /// <summary>Gets the complete fixed vocabulary of valid interest kinds.</summary>
    public static IReadOnlySet<string> All { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        ServicesConsumer,
        ServicesProvider,
        Connect,
    };

    /// <summary>
    /// Reports whether <paramref name="interest"/> is part of the fixed vocabulary.
    /// </summary>
    /// <param name="interest">The candidate interest kind.</param>
    /// <returns><see langword="true"/> if the value is valid.</returns>
    public static bool IsValid(string? interest) =>
        interest is not null && All.Contains(interest);
}
