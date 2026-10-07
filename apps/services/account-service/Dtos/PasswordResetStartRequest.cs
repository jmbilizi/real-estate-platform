// <copyright file="PasswordResetStartRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/password/reset/start</c>.</summary>
internal sealed class PasswordResetStartRequest
{
    /// <summary>Gets or sets the address of the account to recover.</summary>
    public string? Email { get; set; }
}
