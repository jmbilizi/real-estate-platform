// <copyright file="FakeHttpMessageHandler.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Tests.Helpers
{
    /// <summary>An <see cref="HttpMessageHandler"/> that answers every request from a delegate.</summary>
    /// <param name="respond">Builds the response, or throws to simulate a transport failure.</param>
    internal sealed class FakeHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        /// <summary>Gets every request this handler answered, in order.</summary>
        internal List<HttpRequestMessage> Requests { get; } = new();

        /// <summary>Gets the request body of every request this handler answered, in order.</summary>
        internal List<string> RequestBodies { get; } = new();

        /// <inheritdoc/>
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            this.Requests.Add(request);
            this.RequestBodies.Add(
                request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
            return respond(request);
        }
    }
}
