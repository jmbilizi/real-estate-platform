// <copyright file="PostmarkClientTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="PostmarkClient"/> against real Postmark response shapes.</summary>
    public class PostmarkClientTests
    {
        private static readonly OutboundEmail Message = new(
            EmailKind.PasswordReset,
            "Cribstop (Real Broker, LLC)",
            "no-reply@cribstop.com",
            "contact@cribstop.com",
            "person@example.com",
            "Reset your Cribstop password",
            "Open this link: https://cribstop.example/reset-password?email=person%40example.com&code=SECRET-CODE\n\nCribstop is brokered by Real Broker, LLC.");

        [Fact]
        public async Task SendAsync_OnAccept_ReturnsSuccess_AndThePostmarkMessageId()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.OK,
                new { ErrorCode = 0, Message = "OK", MessageID = "msg-123" }));

            var result = await SendAsync(handler);

            result.Success.Should().BeTrue();
            result.MessageId.Should().Be("msg-123");
            result.ErrorCode.Should().Be(0);
        }

        [Fact]
        public async Task SendAsync_SendsTheServerTokenHeader_AndTheMessageStream()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.OK,
                new { ErrorCode = 0, Message = "OK", MessageID = "msg-123" }));

            await SendAsync(handler, serverToken: "real-server-token", messageStream: "outbound");

            var request = handler.Requests.Should().ContainSingle().Subject;
            request.Headers.GetValues("X-Postmark-Server-Token").Should().ContainSingle().Which.Should().Be("real-server-token");
            handler.RequestBodies.Single().Should().Contain("\"MessageStream\":\"outbound\"");
            handler.RequestBodies.Single().Should().Contain("no-reply@cribstop.com");
            handler.RequestBodies.Single().Should().Contain("contact@cribstop.com");
        }

        [Fact]
        public async Task SendAsync_OnAnInvalidToken_ReturnsFailure_WithPostmarksErrorCode()
        {
            // Postmark's real shape for an invalid server token: HTTP 401, ErrorCode 10.
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.Unauthorized,
                new { ErrorCode = 10, Message = "Invalid API key or Server Token." }));

            var result = await SendAsync(handler);

            result.Success.Should().BeFalse();
            result.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            result.ErrorCode.Should().Be(10);
            result.Detail.Should().Contain("Invalid API key");
            result.IsRetryableFailure.Should().BeFalse();
        }

        [Fact]
        public async Task SendAsync_OnAnInvalidRecipient_ReturnsFailure_WithPostmarksErrorCode()
        {
            // Postmark's real shape for a recipient it refuses to send to: HTTP 422, ErrorCode 300.
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.UnprocessableEntity,
                new { ErrorCode = 300, Message = "Invalid email request: 'To' does not contain a valid address." }));

            var result = await SendAsync(handler);

            result.Success.Should().BeFalse();
            result.ErrorCode.Should().Be(300);
        }

        [Fact]
        public async Task SendAsync_OnRateLimit_ReturnsFailure_WithPostmarksErrorCode()
        {
            // Postmark's real shape for exceeding the account send rate: HTTP 429, ErrorCode 406.
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                (HttpStatusCode)429,
                new { ErrorCode = 406, Message = "Account rate limit exceeded." }));

            var result = await SendAsync(handler);

            result.Success.Should().BeFalse();
            result.ErrorCode.Should().Be(406);
            result.IsRetryableFailure.Should().BeTrue();
        }

        [Fact]
        public async Task SendAsync_OnAMalformedResponseBody_ReturnsFailure_RatherThanThrowing()
        {
            // An intermediary error page, or an empty body, in place of Postmark's documented JSON.
            using var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.BadGateway)
            {
                Content = new StringContent("<html>502 Bad Gateway</html>", System.Text.Encoding.UTF8, "text/html"),
            });

            var result = await SendAsync(handler);

            result.Success.Should().BeFalse();
            result.StatusCode.Should().Be(HttpStatusCode.BadGateway);
        }

        [Fact]
        public async Task SendAsync_OnATransportFailure_Throws()
        {
            var handler = new FakeHttpMessageHandler(_ => throw new HttpRequestException("connection reset"));
            try
            {
                var act = () => SendAsync(handler);

                await act.Should().ThrowAsync<HttpRequestException>();
            }
            finally
            {
                handler.Dispose();
            }
        }

        private static HttpResponseMessage JsonResponse(HttpStatusCode status, object body) =>
            new(status) { Content = JsonContent.Create(body) };

        private static async Task<PostmarkSendResult> SendAsync(
            FakeHttpMessageHandler handler,
            string serverToken = "real-server-token",
            string messageStream = "outbound")
        {
            using var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.postmarkapp.com/") };
            var client = new PostmarkClient(
                httpClient,
                Options.Create(new PostmarkOptions { ServerToken = serverToken, MessageStream = messageStream }));

            return await client.SendAsync(Message, CancellationToken.None);
        }
    }
}
