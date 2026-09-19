// <copyright file="UpstreamUnavailableMiddleware.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text;
using Ocelot.Errors;
using Ocelot.Middleware;

namespace ApiGateway.Middleware
{
    /// <summary>
    /// Gives a degraded downstream one documented response body.
    /// </summary>
    /// <remarks>
    /// Ocelot maps a QoS timeout and an open circuit breaker to the same internal error,
    /// <see cref="OcelotErrorCode.RequestTimedOutError"/> (503), and a refused connection to
    /// <see cref="OcelotErrorCode.ConnectionToDownstreamServiceError"/> (502). It answers all three
    /// with an empty body, which forces every client to special-case the gateway. This middleware
    /// writes the <c>{ "error": { "code", "message" } }</c> envelope the property surface uses, so
    /// a client tells "we are having trouble" apart from a 404 or a validation error by
    /// <see cref="ErrorCode"/> alone. The account and inference surfaces carry different envelopes;
    /// see the project AGENTS.md and #177.
    /// <para>
    /// All three share one code on purpose. They are the same fact to a caller — the service did
    /// not answer, retry later — and the distinction between them changes nothing the client can
    /// do. The status Ocelot chose is kept, because 502 and 503 are not the same fact to a proxy,
    /// a probe or a log.
    /// </para>
    /// </remarks>
    internal sealed class UpstreamUnavailableMiddleware
    {
        /// <summary>
        /// The stable <c>error.code</c> for a downstream timeout or an open circuit breaker.
        /// </summary>
        public const string ErrorCode = "upstream_unavailable";

        /// <summary>
        /// The stable <c>error.message</c>. It carries no downstream detail, because these are
        /// public unauthenticated endpoints and the cause belongs in the log.
        /// </summary>
        public const string ErrorMessage = "The service is temporarily unavailable. Please try again shortly.";

        /// <summary>
        /// The stable response body. Serialized once — it never varies.
        /// </summary>
        public const string ResponseBody = "{\"error\":{\"code\":\"" + ErrorCode + "\",\"message\":\"" + ErrorMessage + "\"}}";

        /// <summary>
        /// The status used when a timeout or an open breaker reaches this middleware with no
        /// status of its own. Ocelot normally sets it already.
        /// </summary>
        public const int DefaultStatusCode = 503;

        private static readonly byte[] ResponseBytes = Encoding.UTF8.GetBytes(ResponseBody);

        /// <summary>
        /// The Ocelot errors that mean "the downstream did not answer": a QoS timeout, an open
        /// circuit breaker (both <see cref="OcelotErrorCode.RequestTimedOutError"/>), and a
        /// connection that never opened.
        /// </summary>
        private static readonly OcelotErrorCode[] UnavailableCodes =
        [
            OcelotErrorCode.RequestTimedOutError,
            OcelotErrorCode.ConnectionToDownstreamServiceError,
        ];

        private readonly RequestDelegate next;

        /// <summary>
        /// Initializes a new instance of the <see cref="UpstreamUnavailableMiddleware"/> class.
        /// </summary>
        /// <param name="next">The next middleware in the pipeline.</param>
        public UpstreamUnavailableMiddleware(RequestDelegate next)
        {
            this.next = next;
        }

        /// <summary>
        /// Runs the rest of the pipeline, then writes the documented body if Ocelot reported a
        /// timed-out or circuit-broken downstream.
        /// </summary>
        /// <param name="context">The current HTTP context.</param>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public async Task InvokeAsync(HttpContext context)
        {
            ArgumentNullException.ThrowIfNull(context);

            await next(context).ConfigureAwait(false);

            if (!ShouldWriteBody(context))
            {
                return;
            }

            if (context.Response.StatusCode is < 400 or >= 600)
            {
                context.Response.StatusCode = DefaultStatusCode;
            }

            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength = ResponseBytes.Length;
            await context.Response.Body.WriteAsync(ResponseBytes).ConfigureAwait(false);
        }

        /// <summary>
        /// Reports whether this request ended as an Ocelot QoS failure with no body written.
        /// </summary>
        /// <param name="context">The current HTTP context.</param>
        /// <returns><see langword="true"/> when the documented body must replace an empty response.</returns>
        internal static bool ShouldWriteBody(HttpContext context)
        {
            ArgumentNullException.ThrowIfNull(context);

            // Never overwrite a real answer, including a 503 the downstream service produced.
            // HasStarted alone is not enough: Kestrel leaves it false for a small unflushed body,
            // and appending after those bytes would truncate the response at our ContentLength.
            if (context.Response.HasStarted || context.Response.ContentLength is not (null or 0))
            {
                return false;
            }

            return context.Items.Errors().Exists(error => Array.IndexOf(UnavailableCodes, error.Code) >= 0);
        }
    }
}
