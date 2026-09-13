// <copyright file="ResetPasswordRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// Body of <c>POST /account/password/reset</c>.
/// </summary>
internal sealed class ResetPasswordRequest
{
    /// <summary>Gets or sets the email address of the account being recovered.</summary>
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the URL-safe reset code delivered to the account holder, exactly as issued.
    /// </summary>
    public string? ResetCode { get; set; }

    /// <summary>Gets or sets the replacement password. Validated against the same policy as registration.</summary>
    public string? NewPassword { get; set; }
}
