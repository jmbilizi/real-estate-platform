// <copyright file="OnboardingIntents.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// Fixed vocabulary of self-declared onboarding intents (PRD §4.4). A user may select zero or more
/// of these at signup or change them at any time in Account — they are an optional, multi-select
/// signal and must never collapse to a single persona. Distinct from the RBAC domain roles in
/// <see cref="Roles"/> (PRD §11.2): intents are a lightweight, self-declared signal, not a
/// capability/permission grant — nothing should gate on their presence or absence.
/// </summary>
internal static class OnboardingIntents
{
    /// <summary>The user is looking to buy a home.</summary>
    public const string Buying = "buying";

    /// <summary>The user is looking to sell a home.</summary>
    public const string Selling = "selling";

    /// <summary>The user is looking to rent a home.</summary>
    public const string Renting = "renting";

    /// <summary>The user owns a home.</summary>
    public const string Owning = "owning";

    /// <summary>The user is a professional offering services through the platform.</summary>
    public const string OfferingServices = "offering_services";

    /// <summary>The user is exploring a real estate career.</summary>
    public const string ExploringCareer = "exploring_career";

    /// <summary>Gets the complete fixed vocabulary of valid intent values.</summary>
    public static IReadOnlySet<string> All { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        Buying,
        Selling,
        Renting,
        Owning,
        OfferingServices,
        ExploringCareer,
    };

    /// <summary>
    /// Returns the distinct values in <paramref name="intents"/> that are not part of the fixed
    /// vocabulary. An empty result means every value is valid.
    /// </summary>
    /// <param name="intents">The candidate intent values to check.</param>
    /// <returns>The unknown values, if any.</returns>
    public static IReadOnlyList<string> FindInvalid(IEnumerable<string> intents) =>
        intents.Where(i => !All.Contains(i)).Distinct(StringComparer.Ordinal).ToArray();
}
