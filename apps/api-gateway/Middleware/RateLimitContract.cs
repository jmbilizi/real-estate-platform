// <copyright file="RateLimitContract.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace ApiGateway.Middleware
{
    /// <summary>
    /// The stable body Ocelot's own rate limiter writes at 429.
    /// </summary>
    /// <remarks>
    /// Ocelot's <c>RateLimitOptions.QuotaExceededMessage</c> is the literal response body, written
    /// with no JSON wrapping of its own — a bare human sentence by default. A client's
    /// <c>Response.json()</c> throws on that text, so the 429 fact is lost by the time it reaches
    /// the browser. <see cref="ResponseBody"/> is that same setting, made to be the gateway's
    /// documented envelope instead: valid JSON, parsed by any client regardless of the response's
    /// declared content type. See #177 and <c>apps/api-gateway/AGENTS.md</c> → "Quality of
    /// Service" for the sibling <c>upstream_unavailable</c> code.
    /// </remarks>
    internal static class RateLimitContract
    {
        /// <summary>
        /// The stable <c>error.code</c> for a client that exceeded its rate limit.
        /// </summary>
        public const string ErrorCode = "rate_limited";

        /// <summary>
        /// The stable <c>error.message</c>. It carries no client- or route-specific detail.
        /// </summary>
        public const string ErrorMessage = "Too many requests. Please try again shortly.";

        /// <summary>
        /// The exact string <c>Configuration/Ocelot.Settings.json</c>'s
        /// <c>RateLimitOptions.QuotaExceededMessage</c> must hold. A gateway test asserts the two
        /// never drift apart.
        /// </summary>
        public const string ResponseBody = "{\"error\":{\"code\":\"" + ErrorCode + "\",\"message\":\"" + ErrorMessage + "\"}}";

        /// <summary>
        /// The status Ocelot's rate limiter must be configured to use.
        /// </summary>
        public const int StatusCode = 429;
    }
}
