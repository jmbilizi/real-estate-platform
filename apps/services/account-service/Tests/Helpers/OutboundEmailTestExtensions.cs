// <copyright file="OutboundEmailTestExtensions.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.RegularExpressions;

namespace AccountService.Helpers
{
    /// <summary>Test helpers for reading a composed message.</summary>
    internal static class OutboundEmailTestExtensions
    {
        /// <summary>Reads the one-time code from the plain-text body. The subject carries none.</summary>
        /// <param name="message">A code message.</param>
        /// <returns>The code.</returns>
        internal static string CodeFromBody(this OutboundEmail message) =>
            Regex.Match(message.TextBody, @"\n\n(\d+)\n\n").Groups[1].Value;
    }
}
