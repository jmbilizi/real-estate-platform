// <copyright file="TestEntryPoint.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService;

/// <summary>
/// Non-static class used as the type argument for WebApplicationFactory in integration tests.
/// WebApplicationFactory requires a non-static instantiable class to locate the entry assembly;
/// Program is internal static so it cannot be used directly as a type argument.
/// </summary>
#pragma warning disable CA1515 // Type used as WebApplicationFactory type argument in test project
public sealed class TestEntryPoint
{
}
#pragma warning restore CA1515
