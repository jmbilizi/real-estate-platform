// <copyright file="PasswordResetVerifyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/password/reset/verify</c>.</summary>
internal sealed class PasswordResetVerifyRequest
{
    /// <summary>Gets or sets the address the code went to.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the submitted code.</summary>
    public string? Code { get; set; }
}
