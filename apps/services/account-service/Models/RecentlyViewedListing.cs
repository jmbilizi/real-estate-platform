// <copyright file="RecentlyViewedListing.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Models;

/// <summary>
/// A listing the account opened (#365). The row holds the opaque listing id and the view time only.
/// This service does not hold listing data. No foreign key.
/// </summary>
internal sealed class RecentlyViewedListing
{
    /// <summary>The most rows kept for one account.</summary>
    internal const int MaxPerAccount = 20;

    /// <summary>The longest listing id, in characters.</summary>
    internal const int MaxListingIdLength = 64;

    /// <summary>Gets or sets the account that viewed the listing.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the listing id.</summary>
    public string ListingId { get; set; } = string.Empty;

    /// <summary>Gets or sets when the account last viewed the listing.</summary>
    public DateTime ViewedAt { get; set; }
}
