// <copyright file="RecentlyViewedRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/recently-viewed</c>.</summary>
internal sealed class RecentlyViewedRequest
{
    /// <summary>Gets or sets the id of the viewed listing.</summary>
    public string? ListingId { get; set; }
}
