// <copyright file="PostmarkDeliveryQueueTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="PostmarkDeliveryQueue"/>: the fail-closed check, the retry policy,
    /// and that a code, a link, or a message body is never written to a log entry.
    /// </summary>
    public class PostmarkDeliveryQueueTests
    {
        private const string SecretCode = "SECRET-RESET-CODE";

        private static readonly OutboundEmail Message = new(
            EmailKind.PasswordReset,
            "Cribstop (Real Broker, LLC)",
            "no-reply@cribstop.com",
            "contact@cribstop.com",
            "person@example.com",
            "Reset your Cribstop password",
            $"Open this link: https://cribstop.example/reset-password?email=person%40example.com&code={SecretCode}\n\nCribstop is brokered by Real Broker, LLC.");

        [Fact]
        public async Task DeliverAsync_WhenNotConfigured_SendsNothing_AndLogsTheSuppressedEvent()
        {
            using var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("Postmark must not be called while unconfigured."));

            var (logger, _) = await RunOneMessageAsync(handler, serverToken: PostmarkOptions.PlaceholderServerToken);

            handler.Requests.Should().BeEmpty();
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1370);
            entry.Level.Should().Be(LogLevel.Warning);
            AssertNeverLeaksTheSecret(entry.Message);
        }

        [Theory]
        [InlineData(PostmarkOptions.PlaceholderServerToken, 1370)]
        [InlineData("real-server-token", 1371)]
        public async Task DeliverAsync_ForACodeMessage_LogsNeitherTheAddressNorTheCode(string token, int eventId)
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.OK,
                new { ErrorCode = 0, Message = "OK", MessageID = "msg-1" }));
            var message = IdentityEmailComposerTests.ComposeCodeMessage("person@example.com", "482913");

            var (logger, _) = await RunOneMessageAsync(handler, serverToken: token, message: message);

            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(eventId);
            entry.Message.Should().NotContain("person@example.com");
            entry.Message.Should().NotContain("482913");
            entry.Message.Should().Contain("Code");
        }

        [Fact]
        public async Task DeliverAsync_ForACodeMessage_DropsAPostmarkErrorThatEchoesTheAddress()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.UnprocessableEntity,
                new { ErrorCode = 406, Message = "Inactive recipient: person@example.com" }));
            var message = IdentityEmailComposerTests.ComposeCodeMessage("person@example.com", "482913");

            var (logger, _) = await RunOneMessageAsync(handler, message: message);

            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1372);
            entry.Message.Should().NotContain("person@example.com");
        }

        [Fact]
        public async Task DeliverAsync_OnError406_ReportsTheRecipientOnce_AndDoesNotRetry()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.UnprocessableEntity,
                new { ErrorCode = 406, Message = "You tried to send to a recipient that has been marked as inactive." }));
            var reported = new List<string>();
            var message = IdentityEmailComposerTests.ComposeCodeMessage("person@example.com", "482913");

            var (logger, _) = await RunOneMessageAsync(
                handler,
                retryDelays: new[] { TimeSpan.Zero, TimeSpan.Zero },
                message: message,
                onRecipientInactive: (address, _) =>
                {
                    reported.Add(address);
                    return Task.CompletedTask;
                });

            handler.Requests.Should().HaveCount(1);
            reported.Should().Equal("person@example.com");
            logger.Entries.Should().ContainSingle().Which.EventId.Id.Should().Be(1372);
        }

        [Fact]
        public async Task DeliverAsync_OnAnotherErrorCode_DoesNotReportTheRecipient()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.UnprocessableEntity,
                new { ErrorCode = 300, Message = "Invalid email request." }));
            var reported = new List<string>();

            await RunOneMessageAsync(
                handler,
                onRecipientInactive: (address, _) =>
                {
                    reported.Add(address);
                    return Task.CompletedTask;
                });

            reported.Should().BeEmpty();
        }

        [Fact]
        public async Task DeliverAsync_OnAcceptance_LogsTheAcceptedEvent_WithTheMessageId_NeverTheBody()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.OK,
                new { ErrorCode = 0, Message = "OK", MessageID = "msg-123" }));

            var (logger, _) = await RunOneMessageAsync(handler);

            handler.Requests.Should().HaveCount(1);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1371);
            entry.Message.Should().Contain("msg-123");
            AssertNeverLeaksTheSecret(entry.Message);
        }

        [Fact]
        public async Task DeliverAsync_OnAnApiLevelRejection_LogsOnce_AndDoesNotRetry()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                HttpStatusCode.UnprocessableEntity,
                new { ErrorCode = 300, Message = "Invalid email request." }));

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: new[] { TimeSpan.Zero, TimeSpan.Zero });

            handler.Requests.Should().HaveCount(1);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1372);
            AssertNeverLeaksTheSecret(entry.Message);
        }

        [Fact]
        public async Task DeliverAsync_OnARateLimitThatRecovers_RetriesUntilItSucceeds()
        {
            var attempt = 0;
            using var handler = new FakeHttpMessageHandler(_ =>
            {
                attempt++;
                return attempt < 2
                    ? JsonResponse((HttpStatusCode)429, new { ErrorCode = 406, Message = "Account rate limit exceeded." })
                    : JsonResponse(HttpStatusCode.OK, new { ErrorCode = 0, Message = "OK", MessageID = "msg-789" });
            });

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: new[] { TimeSpan.Zero, TimeSpan.Zero });

            handler.Requests.Should().HaveCount(2);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1371);
        }

        [Fact]
        public async Task DeliverAsync_OnAPersistentRateLimit_GivesUpAfterEveryRetry()
        {
            using var handler = new FakeHttpMessageHandler(_ => JsonResponse(
                (HttpStatusCode)429,
                new { ErrorCode = 406, Message = "Account rate limit exceeded." }));
            var retryDelays = new[] { TimeSpan.Zero, TimeSpan.Zero };

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: retryDelays);

            handler.Requests.Should().HaveCount(retryDelays.Length + 1);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1372);
        }

        [Fact]
        public async Task DeliverAsync_OnAMalformedResponse_LogsRatherThanCrashingTheQueue()
        {
            using var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.BadGateway)
            {
                Content = new StringContent("<html>502 Bad Gateway</html>"),
            });

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: Array.Empty<TimeSpan>());

            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1372);
        }

        [Fact]
        public async Task DeliverAsync_OnATransportFailureThatRecovers_RetriesUntilItSucceeds()
        {
            var attempt = 0;
            using var handler = new FakeHttpMessageHandler(_ =>
            {
                attempt++;
                if (attempt < 2)
                {
                    throw new HttpRequestException("connection reset");
                }

                return JsonResponse(HttpStatusCode.OK, new { ErrorCode = 0, Message = "OK", MessageID = "msg-456" });
            });

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: new[] { TimeSpan.Zero, TimeSpan.Zero });

            handler.Requests.Should().HaveCount(2);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1371);
        }

        [Fact]
        public async Task DeliverAsync_OnAPersistentTransportFailure_GivesUpAfterEveryRetry_AndLogsLoudly()
        {
            using var handler = new FakeHttpMessageHandler(_ => throw new HttpRequestException("connection reset"));
            var retryDelays = new[] { TimeSpan.Zero, TimeSpan.Zero };

            var (logger, _) = await RunOneMessageAsync(handler, retryDelays: retryDelays);

            // One attempt plus one retry per configured delay.
            handler.Requests.Should().HaveCount(retryDelays.Length + 1);
            var entry = logger.Entries.Should().ContainSingle().Subject;
            entry.EventId.Id.Should().Be(1373);
            entry.Level.Should().Be(LogLevel.Error);
            AssertNeverLeaksTheSecret(entry.Message);
        }

        private static void AssertNeverLeaksTheSecret(string logMessage)
        {
            logMessage.Should().NotContain(SecretCode);
            logMessage.Should().NotContain("reset-password?email=");
        }

        private static HttpResponseMessage JsonResponse(HttpStatusCode status, object body) =>
            new(status) { Content = JsonContent.Create(body) };

        private static async Task<(RecordingLogger<PostmarkDeliveryQueue> Logger, FakeHttpMessageHandler Handler)> RunOneMessageAsync(
            FakeHttpMessageHandler handler,
            string serverToken = "real-server-token",
            IReadOnlyList<TimeSpan>? retryDelays = null,
            OutboundEmail? message = null,
            Func<string, CancellationToken, Task>? onRecipientInactive = null)
        {
            using var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.postmarkapp.com/") };
            var client = new PostmarkClient(httpClient, Options.Create(new PostmarkOptions { ServerToken = serverToken }));
            var logger = new RecordingLogger<PostmarkDeliveryQueue>();
            using var queue = new PostmarkDeliveryQueue(
                () => client,
                Options.Create(new PostmarkOptions { ServerToken = serverToken }),
                logger,
                TimeProvider.System,
                retryDelays,
                onRecipientInactive);

            var delivered = new TaskCompletionSource();
            queue.Delivered += _ => delivered.TrySetResult();

            await queue.StartAsync(CancellationToken.None);
            await queue.SendAsync(message ?? Message);
            await delivered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            await queue.StopAsync(CancellationToken.None);

            return (logger, handler);
        }
    }
}
