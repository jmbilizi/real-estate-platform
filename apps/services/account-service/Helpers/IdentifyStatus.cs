// <copyright file="IdentifyStatus.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The outcome of an identify call.</summary>
internal enum IdentifyStatus
{
    /// <summary>The route is in <see cref="IdentifyResult.Next"/>.</summary>
    Ok,

    /// <summary>The address is not well formed.</summary>
    InvalidEmail,

    /// <summary>The code engine has no key.</summary>
    Unavailable,
}
