// <copyright file="EmailHtmlTemplate.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using System.Net;
using System.Text;

namespace AccountService.Helpers;

/// <summary>
/// Renders the HTML part of a transactional email. Table layout and inline CSS only, so mail
/// clients render it. No external image, font or script.
/// </summary>
/// <remarks>
/// Colors come from the web app's Tailwind tokens: <c>brand</c> #ff385c for the accent bar,
/// <c>brand-700</c> #e00b41 for the button (white text on it passes WCAG AA, on #ff385c it does
/// not), <c>brand-50</c> #FFF1F3 for the code box, <c>ink</c> #222222 for text and the footer.
/// </remarks>
internal static class EmailHtmlTemplate
{
    private const string Font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    private const string Mono = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

    /// <summary>Renders the HTML document.</summary>
    /// <param name="content">The message content.</param>
    /// <param name="footer">The footer facts.</param>
    /// <returns>The HTML document.</returns>
    internal static string Render(EmailHtmlContent content, EmailHtmlFooter footer)
    {
        var sb = new StringBuilder();
        sb.Append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">")
            .Append("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
            .Append("<meta name=\"color-scheme\" content=\"light only\">")
            .Append("<title>").Append(E(content.Heading)).Append("</title></head>")
            .Append(CultureInfo.InvariantCulture, $"<body style=\"margin:0;padding:0;background:#f4f4f4;font-family:{Font};\">")
            .Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#f4f4f4;\"><tr><td align=\"center\" style=\"padding:16px 8px;\">")
            .Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px;width:100%;\">")
            .Append("<tr><td style=\"background:#ff385c;height:6px;line-height:6px;font-size:6px;\">&nbsp;</td></tr>")
            .Append(CultureInfo.InvariantCulture, $"<tr><td style=\"background:#ffffff;padding:32px 24px;color:#222222;font-family:{Font};\">")
            .Append(CultureInfo.InvariantCulture, $"<h1 style=\"margin:0 0 16px 0;font-size:24px;line-height:30px;font-weight:700;color:#222222;\">{E(content.Heading)}</h1>");

        foreach (var paragraph in content.Paragraphs)
        {
            sb.Append(CultureInfo.InvariantCulture, $"<p style=\"margin:0 0 16px 0;font-size:16px;line-height:24px;color:#222222;\">{E(paragraph)}</p>");
        }

        if (content.Code is not null)
        {
            sb.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 20px 0;\"><tr>")
                .Append("<td align=\"center\" style=\"background:#fff1f3;border:1px solid #fecdd3;border-radius:8px;padding:20px 8px;")
                .Append(CultureInfo.InvariantCulture, $"font-family:{Mono};font-size:36px;line-height:44px;font-weight:700;letter-spacing:8px;color:#222222;\">")
                .Append(E(content.Code)).Append("</td></tr></table>");
        }

        if (content.ButtonText is not null && content.ButtonUrl is not null)
        {
            var url = E(content.ButtonUrl.AbsoluteUri);
            sb.Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:8px 0 20px 0;\"><tr>")
                .Append("<td style=\"background:#e00b41;border-radius:8px;\">")
                .Append(CultureInfo.InvariantCulture, $"<a href=\"{url}\" style=\"display:inline-block;padding:14px 24px;font-family:{Font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;\">{E(content.ButtonText)}</a>")
                .Append("</td></tr></table>")
                .Append(CultureInfo.InvariantCulture, $"<p style=\"margin:0 0 16px 0;font-size:14px;line-height:20px;color:#555555;word-break:break-all;\">{url}</p>");
        }

        foreach (var note in content.Notes ?? Array.Empty<string>())
        {
            sb.Append(CultureInfo.InvariantCulture, $"<p style=\"margin:0 0 12px 0;font-size:14px;line-height:20px;color:#555555;\">{E(note)}</p>");
        }

        sb.Append("</td></tr>")
            .Append(CultureInfo.InvariantCulture, $"<tr><td style=\"background:#222222;padding:24px;color:#d9d9d9;font-family:{Font};font-size:13px;line-height:20px;\">")
            .Append("<p style=\"margin:0 0 8px 0;font-size:18px;line-height:24px;font-weight:700;color:#ffffff;\">Cribstop.com</p>")
            .Append(CultureInfo.InvariantCulture, $"<p style=\"margin:0 0 12px 0;color:#d9d9d9;\">{E(footer.BrokerageDisclosure)}</p>")
            .Append("<p style=\"margin:0;color:#d9d9d9;\">");

        if (footer.PrivacyUrl is not null && footer.TermsUrl is not null)
        {
            sb.Append(CultureInfo.InvariantCulture, $"<a href=\"{E(footer.PrivacyUrl.AbsoluteUri)}\" style=\"color:#ffffff;text-decoration:underline;\">Privacy Policy</a>")
                .Append(" &nbsp;|&nbsp; ")
                .Append(CultureInfo.InvariantCulture, $"<a href=\"{E(footer.TermsUrl.AbsoluteUri)}\" style=\"color:#ffffff;text-decoration:underline;\">Terms</a>")
                .Append("<br>");
        }

        sb.Append("Questions? Reply to this email at ")
            .Append(CultureInfo.InvariantCulture, $"<a href=\"mailto:{E(footer.ReplyToAddress)}\" style=\"color:#ffffff;text-decoration:underline;\">{E(footer.ReplyToAddress)}</a>.")
            .Append("</p></td></tr></table></td></tr></table></body></html>");
        return sb.ToString();
    }

    private static string E(string value) => WebUtility.HtmlEncode(value);
}
