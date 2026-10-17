// <copyright file="NewDeviceSettingRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>Body of <c>PUT /account/security/new-device</c>.</summary>
internal sealed class NewDeviceSettingRequest
{
    /// <summary>Gets or sets a value indicating whether a new device needs an emailed code.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the current password. It is the step-up proof.</summary>
    public string? CurrentPassword { get; set; }
}
