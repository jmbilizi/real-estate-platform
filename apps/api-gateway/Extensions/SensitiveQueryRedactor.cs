// <copyright file="SensitiveQueryRedactor.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.RegularExpressions;

namespace ApiGateway.Extensions
{
    /// <summary>
    /// Removes the one-click unsubscribe token (<c>t</c>) from URLs that reach traces (#694). The token never
    /// expires, so it must not sit in a trace attribute. The route is <c>/notifications/unsubscribe</c>.
    /// </summary>
    internal static partial class SensitiveQueryRedactor
    {
        /// <summary>The path whose <c>t</c> query value is secret.</summary>
        public const string UnsubscribePath = "/notifications/unsubscribe";

        /// <summary>The value that replaces the token.</summary>
        public const string Redacted = "REDACTED";

        /// <summary>Checks whether a request path is the unsubscribe path.</summary>
        /// <param name="path">The request path.</param>
        /// <returns><see langword="true"/> for the unsubscribe path.</returns>
        public static bool IsSensitivePath(string? path) =>
            path is not null && path.StartsWith(UnsubscribePath, StringComparison.OrdinalIgnoreCase);

        /// <summary>Replaces the <c>t</c> value in a query string or a URL.</summary>
        /// <param name="value">A query string (with or without <c>?</c>) or a full URL.</param>
        /// <returns>The same text with the token replaced.</returns>
        public static string Redact(string? value) =>
            string.IsNullOrEmpty(value) ? string.Empty : TokenParameter().Replace(value, "${1}${2}" + Redacted);

        /// <summary>Overwrites the URL tags of a span when the request is for the unsubscribe path.</summary>
        /// <param name="activity">The span.</param>
        /// <param name="path">The request path.</param>
        public static void RedactTags(System.Diagnostics.Activity? activity, string? path)
        {
            if (activity is null || !IsSensitivePath(path))
            {
                return;
            }

            foreach (var key in new[] { "url.query", "url.full", "http.url", "http.target" })
            {
                if (activity.GetTagItem(key) is string current)
                {
                    activity.SetTag(key, Redact(current));
                }
            }
        }

        [GeneratedRegex("(^|[?&])(t=)[^&#]*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
        private static partial Regex TokenParameter();
    }
}
