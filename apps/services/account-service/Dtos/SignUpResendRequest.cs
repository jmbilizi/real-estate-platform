// <copyright file="SignUpResendRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/signup/resend</c>.</summary>
internal sealed class SignUpResendRequest
{
    /// <summary>Gets or sets the address to send a new code to.</summary>
    public string? Email { get; set; }
}
