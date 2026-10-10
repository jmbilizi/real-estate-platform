// <copyright file="LookingForRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Request body of <c>PUT /account/looking-for/{id}</c>. The body replaces the preference.</summary>
internal sealed class LookingForRequest
{
    /// <summary>Gets or sets the intent: <c>buy</c> or <c>rent</c>.</summary>
    public string? Intent { get; set; }

    /// <summary>Gets or sets the places. One to five.</summary>
    public List<LookingForPlace>? Places { get; set; }

    /// <summary>Gets or sets the lowest price in whole dollars.</summary>
    public int? PriceMin { get; set; }

    /// <summary>Gets or sets the highest price in whole dollars.</summary>
    public int? PriceMax { get; set; }

    /// <summary>Gets or sets the lowest number of bedrooms.</summary>
    public int? BedsMin { get; set; }

    /// <summary>Gets or sets the lowest number of bathrooms.</summary>
    public int? BathsMin { get; set; }

    /// <summary>Gets or sets the home types. Empty or null means any.</summary>
    public List<string>? HomeTypes { get; set; }

    /// <summary>Gets or sets the move-in date or the first day of the buying window (yyyy-MM-dd).</summary>
    public DateOnly? WhenStart { get; set; }

    /// <summary>Gets or sets the last day of the buying window. Needs <see cref="WhenStart"/>.</summary>
    public DateOnly? WhenEnd { get; set; }
}
