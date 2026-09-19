// <copyright file="UpstreamUnavailableMiddlewareTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text;
using ApiGateway.Middleware;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Newtonsoft.Json.Linq;
using Ocelot.Errors;
using Xunit;

namespace ApiGateway.Tests.Middleware
{
    /// <summary>
    /// Unit tests for <see cref="UpstreamUnavailableMiddleware"/>.
    /// </summary>
    public class UpstreamUnavailableMiddlewareTests
    {
        [Fact]
        public void ResponseBody_ShouldMatchTheServiceErrorEnvelope()
        {
            // Assert — one shape for every failure the client can meet, gateway or service.
            var body = JObject.Parse(UpstreamUnavailableMiddleware.ResponseBody);

            ((string?)body["error"]!["code"]).Should().Be("upstream_unavailable");
            ((string?)body["error"]!["message"]).Should().NotBeNullOrWhiteSpace();
            UpstreamUnavailableMiddleware.DefaultStatusCode.Should().Be(503);
        }

        [Fact]
        public async Task Invoke_WithATimedOutDownstream_ShouldWriteTheDocumentedBody()
        {
            // Arrange
            var context = NewContext();
            var middleware = new UpstreamUnavailableMiddleware(ctx =>
            {
                ctx.Items["Errors"] = new List<Error> { new TestTimedOutError() };
                ctx.Response.StatusCode = 503;
                return Task.CompletedTask;
            });

            // Act
            await middleware.InvokeAsync(context).ConfigureAwait(true);

            // Assert
            context.Response.StatusCode.Should().Be(503);
            context.Response.ContentType.Should().StartWith("application/json");
            ReadBody(context).Should().Be(UpstreamUnavailableMiddleware.ResponseBody);
        }

        [Fact]
        public async Task Invoke_WithAnUnreachableDownstream_ShouldKeepThe502AndWriteTheBody()
        {
            // Arrange — a refused connection, which Ocelot answers 502 with an empty body.
            var context = NewContext();
            var middleware = new UpstreamUnavailableMiddleware(ctx =>
            {
                ctx.Items["Errors"] = new List<Error> { new TestConnectionError() };
                ctx.Response.StatusCode = 502;
                return Task.CompletedTask;
            });

            // Act
            await middleware.InvokeAsync(context).ConfigureAwait(true);

            // Assert — 502 and 503 are different facts to a proxy, so the status is left alone.
            context.Response.StatusCode.Should().Be(502);
            ReadBody(context).Should().Be(UpstreamUnavailableMiddleware.ResponseBody);
        }

        [Fact]
        public async Task Invoke_WithNoOcelotError_ShouldLeaveTheResponseAlone()
        {
            // Arrange
            var context = NewContext();
            var middleware = new UpstreamUnavailableMiddleware(ctx =>
            {
                ctx.Response.StatusCode = 404;
                return Task.CompletedTask;
            });

            // Act
            await middleware.InvokeAsync(context).ConfigureAwait(true);

            // Assert — a 404 must stay a 404 with no body of ours.
            context.Response.StatusCode.Should().Be(404);
            ReadBody(context).Should().BeEmpty();
        }

        [Fact]
        public async Task Invoke_WithAStartedResponse_ShouldNotAppendToTheDownstreamBody()
        {
            // Arrange — Ocelot recorded the error AND the downstream body already went out. The
            // errors check alone would not stop the write here: only the HasStarted guard does,
            // and appending after those bytes would truncate the response at our ContentLength.
            var context = NewContext();
            var downstreamBody = "{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal server error.\"}}";
            context.Features.Set<IHttpResponseFeature>(new StartedResponseFeature(context.Response.Body));

            var middleware = new UpstreamUnavailableMiddleware(async ctx =>
            {
                ctx.Items["Errors"] = new List<Error> { new TestTimedOutError() };
                ctx.Response.StatusCode = 503;
                await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(downstreamBody)).ConfigureAwait(false);
            });

            // Act
            await middleware.InvokeAsync(context).ConfigureAwait(true);

            // Assert
            context.Response.HasStarted.Should().BeTrue("the guard under test must be the one that fires");
            ReadBody(context).Should().Be(downstreamBody);
        }

        [Fact]
        public async Task Invoke_WithABodyAlreadyCounted_ShouldLeaveItAlone()
        {
            // Arrange — an unflushed body leaves HasStarted false, so ContentLength is the second
            // half of the guard.
            var context = NewContext();
            var downstreamBody = "{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal server error.\"}}";
            var middleware = new UpstreamUnavailableMiddleware(async ctx =>
            {
                ctx.Items["Errors"] = new List<Error> { new TestTimedOutError() };
                ctx.Response.StatusCode = 503;
                ctx.Response.ContentLength = downstreamBody.Length;
                await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(downstreamBody)).ConfigureAwait(false);
            });

            // Act
            await middleware.InvokeAsync(context).ConfigureAwait(true);

            // Assert
            ReadBody(context).Should().Be(downstreamBody);
        }

        private static DefaultHttpContext NewContext()
        {
            var context = new DefaultHttpContext();
            context.Response.Body = new MemoryStream();
            return context;
        }

        private static string ReadBody(HttpContext context)
        {
            context.Response.Body.Position = 0;
            using var reader = new StreamReader(context.Response.Body, Encoding.UTF8, leaveOpen: true);
            return reader.ReadToEnd();
        }

        /// <summary>
        /// Ocelot's <see cref="Error"/> is abstract, so the timeout error is restated here.
        /// </summary>
        private sealed class TestTimedOutError : Error
        {
            public TestTimedOutError()
                : base("Timeout", OcelotErrorCode.RequestTimedOutError, 503)
            {
            }
        }

        /// <summary>
        /// A response feature that reports the response as started. `DefaultHttpContext` over a
        /// `MemoryStream` never sets `HasStarted`, so the guard would otherwise be untestable.
        /// </summary>
        private sealed class StartedResponseFeature : IHttpResponseFeature
        {
            public StartedResponseFeature(Stream body)
            {
                Body = body;
            }

            public int StatusCode { get; set; } = 200;

            public string? ReasonPhrase { get; set; }

            public IHeaderDictionary Headers { get; set; } = new HeaderDictionary();

            public Stream Body { get; set; }

            public bool HasStarted => true;

            public void OnStarting(Func<object, Task> callback, object state)
            {
            }

            public void OnCompleted(Func<object, Task> callback, object state)
            {
            }
        }

        /// <summary>
        /// Ocelot's error for a downstream that never accepted the connection.
        /// </summary>
        private sealed class TestConnectionError : Error
        {
            public TestConnectionError()
                : base("Connection refused", OcelotErrorCode.ConnectionToDownstreamServiceError, 502)
            {
            }
        }
    }
}
