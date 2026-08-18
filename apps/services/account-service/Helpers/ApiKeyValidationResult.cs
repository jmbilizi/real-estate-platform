// <copyright file="ApiKeyValidationResult.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>
/// The result of an API key validation, pairing the typed status with the matched key (when one was found).
/// </summary>
/// <param name="Status">The validation status.</param>
/// <param name="ApiKey">The matched key, or <see langword="null"/> when no key matched.</param>
internal sealed record ApiKeyValidationResult(ApiKeyValidationStatus Status, ApiKey? ApiKey);
