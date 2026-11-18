// <copyright file="GoogleSignInRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/login/google</c>.</summary>
internal sealed class GoogleSignInRequest
{
    /// <summary>Gets or sets the Google ID token (the GIS <c>credential</c>).</summary>
    public string? Credential { get; set; }
}
