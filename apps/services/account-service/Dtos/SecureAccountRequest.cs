// <copyright file="SecureAccountRequest.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Dtos;

/// <summary>The body of <c>POST /account/secure</c>: the token from the "This wasn't me" link.</summary>
/// <param name="Token">The token from the security notice link.</param>
internal sealed record SecureAccountRequest(string? Token);
