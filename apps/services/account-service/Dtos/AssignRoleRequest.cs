// <copyright file="AssignRoleRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.ComponentModel.DataAnnotations;

namespace AccountService.Dtos;

/// <summary>
/// Request body for assigning a role to a user.
/// </summary>
internal sealed class AssignRoleRequest
{
    /// <summary>Gets or sets the name of the role to assign.</summary>
    [Required]
    [MaxLength(256)]
    public string Role { get; set; } = string.Empty;
}
