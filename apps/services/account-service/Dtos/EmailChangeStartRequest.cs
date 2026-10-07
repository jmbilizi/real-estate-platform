// <copyright file="EmailChangeStartRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>The body of <c>POST /account/email/change/start</c> (#660).</summary>
internal sealed class EmailChangeStartRequest
{
    /// <summary>Gets or sets the address the account moves to.</summary>
    public string? NewEmail { get; set; }

    /// <summary>Gets or sets the current password, as typed. It is the first step-up choice.</summary>
    public string? CurrentPassword { get; set; }

    /// <summary>Gets or sets the code sent to the old address. It is the second step-up choice.</summary>
    public string? OldEmailCode { get; set; }
}
