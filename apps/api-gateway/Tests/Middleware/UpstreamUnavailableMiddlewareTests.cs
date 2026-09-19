// <copyright file="UpstreamUnavailableMiddlewareTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text;
using ApiGateway.Middleware;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
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
        public async Task Invoke_WithADownstream503_ShouldKeepTheDownstreamBody()
        {
            // Arrange — the service itself answered 503 and wrote its own body.
            var context = NewContext();
            var downstreamBody = "{\"error\":{\"code\":\"internal_error\",\"message\":\"Internal server error.\"}}";
            var middleware = new UpstreamUnavailableMiddleware(async ctx =>
            {
                ctx.Response.StatusCode = 503;
                await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(downstreamBody)).ConfigureAwait(false);
                await ctx.Response.Body.FlushAsync().ConfigureAwait(false);
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
