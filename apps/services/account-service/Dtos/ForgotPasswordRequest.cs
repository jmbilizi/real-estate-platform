// <copyright file="ForgotPasswordRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>
/// Body of <c>POST /account/password/forgot</c>.
/// </summary>
/// <remarks>
/// The address is the only field, and deliberately the only field. A recovery flow has no business
/// collecting anything else about the person trying to get back in.
/// </remarks>
internal sealed class ForgotPasswordRequest
{
    /// <summary>Gets or sets the email address of the account to recover.</summary>
    public string? Email { get; set; }
}
