// <copyright file="EmailHtmlContent.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Helpers;

/// <summary>The content of one HTML email. Every string is plain text. The template encodes it.</summary>
/// <param name="Heading">The heading.</param>
/// <param name="Paragraphs">The paragraphs above the code or button.</param>
/// <param name="Code">The one-time code, or null.</param>
/// <param name="ButtonText">The button label, or null for no button.</param>
/// <param name="ButtonUrl">The button target. Required with <paramref name="ButtonText"/>.</param>
/// <param name="Notes">The small-print paragraphs below the code or button.</param>
internal sealed record EmailHtmlContent(
    string Heading,
    IReadOnlyList<string> Paragraphs,
    string? Code = null,
    string? ButtonText = null,
    Uri? ButtonUrl = null,
    IReadOnlyList<string>? Notes = null);
