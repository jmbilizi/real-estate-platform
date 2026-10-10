// <copyright file="LookingForPlace.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// A place, in the shape of the search URL place (#350). <c>city</c> needs City and State.
/// <c>zip</c> needs Zip, City and State. <c>neighborhood</c> and <c>street</c> need Name, City and
/// State. <c>county</c> needs County and State.
/// </summary>
internal sealed class LookingForPlace
{
    /// <summary>Gets or sets the kind: city, zip, neighborhood, street or county.</summary>
    public string? Kind { get; set; }

    /// <summary>Gets or sets the two-letter state code.</summary>
    public string? State { get; set; }

    /// <summary>Gets or sets the city.</summary>
    public string? City { get; set; }

    /// <summary>Gets or sets the five-digit ZIP code.</summary>
    public string? Zip { get; set; }

    /// <summary>Gets or sets the neighborhood or street name.</summary>
    public string? Name { get; set; }

    /// <summary>Gets or sets the county name, without the word "County".</summary>
    public string? County { get; set; }
}
