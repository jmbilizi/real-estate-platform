// <copyright file="LookingForLimits.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>Limits and vocabulary of the "What I'm looking for" preference (#768).</summary>
internal static class LookingForLimits
{
    /// <summary>The most preferences one account holds.</summary>
    public const int MaxPerAccount = 5;

    /// <summary>The most places in one preference.</summary>
    public const int MaxPlaces = 5;

    /// <summary>The highest price, in whole dollars.</summary>
    public const int MaxPrice = 100_000_000;

    /// <summary>The highest bedroom and bathroom count.</summary>
    public const int MaxRooms = 20;

    /// <summary>Gets the valid intents.</summary>
    public static IReadOnlySet<string> Intents { get; } = new HashSet<string>(StringComparer.Ordinal) { "buy", "rent" };

    /// <summary>Gets the valid place kinds.</summary>
    public static IReadOnlySet<string> PlaceKinds { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "city", "zip", "neighborhood", "street", "county",
    };

    /// <summary>Gets the valid home types. Mirrors <c>PROPERTY_TYPES</c> in <c>@cribstop/property-contracts</c>.</summary>
    public static IReadOnlySet<string> HomeTypes { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "Single Family", "Condo", "Townhome", "Multi-Family", "Loft", "Land", "New Construction", "Manufactured/Mobile",
    };
}
