// <copyright file="SignUpVerifyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/signup/verify</c>.</summary>
internal sealed class SignUpVerifyRequest
{
    /// <summary>Gets or sets the address the code went to.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the submitted code.</summary>
    public string? Code { get; set; }
}
