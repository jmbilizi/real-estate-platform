// <copyright file="SignUpChangeEmailRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/signup/change-email</c>.</summary>
internal sealed class SignUpChangeEmailRequest
{
    /// <summary>Gets or sets the address to drop.</summary>
    public string? OldEmail { get; set; }

    /// <summary>Gets or sets the address to sign up instead.</summary>
    public string? NewEmail { get; set; }
}
