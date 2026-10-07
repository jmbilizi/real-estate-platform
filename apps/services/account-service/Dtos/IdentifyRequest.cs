// <copyright file="IdentifyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/identify</c>.</summary>
internal sealed class IdentifyRequest
{
    /// <summary>Gets or sets the address the user entered.</summary>
    public string? Email { get; set; }
}
