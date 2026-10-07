// <copyright file="ContactLookupRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /internal/account/contacts</c>.</summary>
internal sealed class ContactLookupRequest
{
    /// <summary>Gets or sets the account ids to resolve. One to 100 ids.</summary>
    public Guid[]? AccountIds { get; set; }
}
