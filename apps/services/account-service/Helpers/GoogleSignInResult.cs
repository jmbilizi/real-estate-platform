// <copyright file="GoogleSignInResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>The result of <see cref="GoogleSignInService.SignInAsync"/>.</summary>
/// <param name="Status">What happened.</param>
/// <param name="User">For <c>SignedIn</c>, the account.</param>
/// <param name="Created">Whether this call created the account.</param>
internal sealed record GoogleSignInResult(GoogleSignInStatus Status, ApplicationUser? User = null, bool Created = false);
