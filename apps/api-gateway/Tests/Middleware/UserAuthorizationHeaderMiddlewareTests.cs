// <copyright file="UserAuthorizationHeaderMiddlewareTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using ApiGateway.Middleware;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace ApiGateway.Tests.Middleware
{
    /// <summary>
    /// Unit tests for <see cref="UserAuthorizationHeaderMiddleware"/>.
    /// </summary>
    public class UserAuthorizationHeaderMiddlewareTests
    {
        [Fact]
        public async Task Invoke_WithTheUserHeader_ShouldReplaceTheIngressBasicCredential()
        {
            // Arrange
            var context = new DefaultHttpContext();
            context.Request.Headers.Authorization = "Basic aW5ncmVzczpwdw==";
            context.Request.Headers[UserAuthorizationHeaderMiddleware.HeaderName] = "Bearer user-token";

            // Act
            await Run(context).ConfigureAwait(true);

            // Assert
            context.Request.Headers.Authorization.ToString().Should().Be("Bearer user-token");
            context.Request.Headers.ContainsKey(UserAuthorizationHeaderMiddleware.HeaderName).Should().BeFalse();
        }

        [Fact]
        public async Task Invoke_WithNoUserHeader_ShouldKeepAuthorization()
        {
            // Arrange — the in-cluster web app sends the bearer token in Authorization directly.
            var context = new DefaultHttpContext();
            context.Request.Headers.Authorization = "Bearer user-token";

            // Act
            await Run(context).ConfigureAwait(true);

            // Assert
            context.Request.Headers.Authorization.ToString().Should().Be("Bearer user-token");
        }

        [Fact]
        public async Task Invoke_WithAnEmptyUserHeader_ShouldKeepAuthorizationAndDropTheHeader()
        {
            // Arrange
            var context = new DefaultHttpContext();
            context.Request.Headers.Authorization = "Basic aW5ncmVzczpwdw==";
            context.Request.Headers[UserAuthorizationHeaderMiddleware.HeaderName] = " ";

            // Act
            await Run(context).ConfigureAwait(true);

            // Assert
            context.Request.Headers.Authorization.ToString().Should().Be("Basic aW5ncmVzczpwdw==");
            context.Request.Headers.ContainsKey(UserAuthorizationHeaderMiddleware.HeaderName).Should().BeFalse();
        }

        private static async Task Run(HttpContext context)
        {
            var called = false;
            var middleware = new UserAuthorizationHeaderMiddleware(_ =>
            {
                called = true;
                return Task.CompletedTask;
            });

            await middleware.InvokeAsync(context).ConfigureAwait(true);
            called.Should().BeTrue();
        }
    }
}
