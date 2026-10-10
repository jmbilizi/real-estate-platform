// <copyright file="LookingForPreference.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// One "What I'm looking for" preference of an account (#768). An account holds up to
/// <see cref="LookingForLimits.MaxPerAccount"/> of them, so one account can look to buy and to rent
/// at the same time (PRD §11.2). The row holds facts about the home only. It holds no protected-class
/// signal (PRD §6). The composite key (UserId, Id) keeps every account's rows apart.
/// </summary>
internal sealed class LookingForPreference
{
    /// <summary>Gets or sets the id. The client picks it, and it is unique only inside one account.</summary>
    public Guid Id { get; set; }

    /// <summary>Gets or sets the owning account's id.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the intent (see <see cref="LookingForLimits.Intents"/>).</summary>
    public string Intent { get; set; } = string.Empty;

    /// <summary>Gets or sets the places as a JSON array of <c>LookingForPlace</c> objects.</summary>
    public string PlacesJson { get; set; } = "[]";

    /// <summary>Gets or sets the lowest price in whole dollars.</summary>
    public int? PriceMin { get; set; }

    /// <summary>Gets or sets the highest price in whole dollars.</summary>
    public int? PriceMax { get; set; }

    /// <summary>Gets or sets the lowest number of bedrooms.</summary>
    public int? BedsMin { get; set; }

    /// <summary>Gets or sets the lowest number of bathrooms.</summary>
    public int? BathsMin { get; set; }

    /// <summary>Gets or sets the home types (search home-type values). Empty means any.</summary>
    public List<string> HomeTypes { get; set; } = new();

    /// <summary>Gets or sets the move-in date, or the first day of the buying window.</summary>
    public DateOnly? WhenStart { get; set; }

    /// <summary>Gets or sets the last day of the buying window. Null for a single date.</summary>
    public DateOnly? WhenEnd { get; set; }

    /// <summary>Gets or sets the UTC time of creation.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the UTC time of the last change.</summary>
    public DateTime UpdatedAt { get; set; }
}
