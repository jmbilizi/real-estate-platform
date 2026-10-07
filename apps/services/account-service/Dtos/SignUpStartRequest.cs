// <copyright file="SignUpStartRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/signup/start</c>.</summary>
internal sealed class SignUpStartRequest
{
    /// <summary>Gets or sets the address to sign up.</summary>
    public string? Email { get; set; }
}
