// <copyright file="DeviceSignInRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/login/device</c>. The password is checked again with the code.</summary>
internal sealed class DeviceSignInRequest
{
    /// <summary>Gets or sets the account email.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the password.</summary>
    public string? Password { get; set; }

    /// <summary>Gets or sets the emailed code.</summary>
    public string? Code { get; set; }
}
