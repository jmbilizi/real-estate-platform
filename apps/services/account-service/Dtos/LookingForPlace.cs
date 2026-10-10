// <copyright file="LookingForPlace.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// A place, in the shape of the search URL place (#350). Only <c>city</c> and <c>zip</c> are
/// accepted until the web form supports the other kinds. <c>city</c> needs City and State.
/// <c>zip</c> needs Zip, City and State. Name and County are reserved and must be absent.
/// </summary>
internal sealed class LookingForPlace
{
    /// <summary>Gets or sets the kind: city or zip.</summary>
    public string? Kind { get; set; }

    /// <summary>Gets or sets the two-letter state code.</summary>
    public string? State { get; set; }

    /// <summary>Gets or sets the city.</summary>
    public string? City { get; set; }

    /// <summary>Gets or sets the five-digit ZIP code.</summary>
    public string? Zip { get; set; }

    /// <summary>Gets or sets the reserved neighborhood or street name. Must be absent.</summary>
    public string? Name { get; set; }

    /// <summary>Gets or sets the reserved county name. Must be absent.</summary>
    public string? County { get; set; }
}
