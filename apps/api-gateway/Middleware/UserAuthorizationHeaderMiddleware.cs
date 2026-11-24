// <copyright file="UserAuthorizationHeaderMiddleware.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.Extensions.Primitives;

namespace ApiGateway.Middleware
{
    /// <summary>
    /// Moves the caller's credential from <c>X-User-Authorization</c> to <c>Authorization</c>.
    /// </summary>
    /// <remarks>
    /// The gateway Ingress has nginx basic auth, which reads <c>Authorization</c>. A caller outside
    /// the cluster cannot put a user's bearer token in the same header. It sends the token in
    /// <see cref="HeaderName"/> and this middleware restores it before Ocelot forwards the request.
    /// The downstream service still validates the token, so the header gives no new access.
    /// </remarks>
    internal sealed class UserAuthorizationHeaderMiddleware
    {
        /// <summary>
        /// The header that carries the user's credential past the Ingress basic auth.
        /// </summary>
        public const string HeaderName = "X-User-Authorization";

        private readonly RequestDelegate _next;

        /// <summary>
        /// Initializes a new instance of the <see cref="UserAuthorizationHeaderMiddleware"/> class.
        /// </summary>
        /// <param name="next">The next middleware in the pipeline.</param>
        public UserAuthorizationHeaderMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        /// <summary>
        /// Replaces <c>Authorization</c> with the value of <see cref="HeaderName"/>, when present.
        /// </summary>
        /// <param name="context">The HTTP context.</param>
        /// <returns>A task that completes when the pipeline completes.</returns>
        public Task InvokeAsync(HttpContext context)
        {
            IHeaderDictionary headers = context.Request.Headers;
            if (headers.TryGetValue(HeaderName, out StringValues value))
            {
                headers.Remove(HeaderName);
                if (!StringValues.IsNullOrEmpty(value) && !string.IsNullOrWhiteSpace(value.ToString()))
                {
                    headers.Authorization = value;
                }
            }

            return _next(context);
        }
    }
}
