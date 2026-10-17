// <copyright file="DeviceSignInResendRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>POST /account/login/device/resend</c>. The password gates the send.</summary>
internal sealed class DeviceSignInResendRequest
{
    /// <summary>Gets or sets the account email.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the password.</summary>
    public string? Password { get; set; }
}
