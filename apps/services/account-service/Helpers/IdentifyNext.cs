// <copyright file="IdentifyNext.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The next step the client shows.</summary>
internal enum IdentifyNext
{
    /// <summary>Ask for the password.</summary>
    Password,

    /// <summary>Ask for the emailed code.</summary>
    Code,
}
