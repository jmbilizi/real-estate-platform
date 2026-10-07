// <copyright file="EmailChangeVerifyRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>The body of <c>POST /account/email/change/verify</c> (#660).</summary>
internal sealed class EmailChangeVerifyRequest
{
    /// <summary>Gets or sets the code sent to the new address.</summary>
    public string? Code { get; set; }
}
