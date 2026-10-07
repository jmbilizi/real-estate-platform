// <copyright file="SignUpCompleteRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/signup/complete</c>.</summary>
internal sealed class SignUpCompleteRequest
{
    /// <summary>Gets or sets the verified address.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the proof the verify step returned.</summary>
    public string? SignupProof { get; set; }

    /// <summary>Gets or sets the new password. It is never trimmed or truncated.</summary>
    public string? Password { get; set; }
}
