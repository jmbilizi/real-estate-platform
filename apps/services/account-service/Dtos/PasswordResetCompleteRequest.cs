// <copyright file="PasswordResetCompleteRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/password/reset/complete</c>.</summary>
internal sealed class PasswordResetCompleteRequest
{
    /// <summary>Gets or sets the address of the account.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the proof the verify step returned.</summary>
    public string? ResetProof { get; set; }

    /// <summary>Gets or sets the new password. It is never trimmed or truncated.</summary>
    public string? NewPassword { get; set; }
}
