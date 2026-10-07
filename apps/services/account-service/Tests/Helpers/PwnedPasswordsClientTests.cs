// <copyright file="PwnedPasswordsClientTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

#pragma warning disable CA2000 // Test doubles live for the test.

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="PwnedPasswordsClient"/> (#654).</summary>
    public class PwnedPasswordsClientTests
    {
        private const string Password = "P@ssw0rd";

        [Fact]
        public async Task SendsOnlyThePrefix_WithAddPadding_AndReportsAMatch()
        {
            var hash = Sha1(Password);
            var handler = new StubHandler(_ => Respond($"0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n{hash[5..]}:42\r\n"));
            var client = Build(handler, out _);

            (await client.IsBreachedAsync(Password)).Should().BeTrue();

            var request = handler.Requests.Should().ContainSingle().Subject;
            request.RequestUri!.ToString().Should().EndWith("range/" + hash[..5]);
            request.RequestUri.ToString().Should().NotContain(hash[5..]).And.NotContain(Password);
            request.Headers.GetValues("Add-Padding").Should().Equal("true");
        }

        [Fact]
        public async Task APaddingEntryWithCountZero_IsNotAMatch()
        {
            var hash = Sha1(Password);
            var client = Build(new StubHandler(_ => Respond($"{hash[5..]}:0\r\n")), out _);

            (await client.IsBreachedAsync(Password)).Should().BeFalse();
        }

        [Fact]
        public async Task NoMatchingSuffix_IsClean()
        {
            var client = Build(new StubHandler(_ => Respond("0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n")), out _);

            (await client.IsBreachedAsync(Password)).Should().BeFalse();
        }

        [Fact]
        public async Task ANonSuccessStatus_ReturnsNull_AndLogsNoHashOrPassword()
        {
            var client = Build(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)), out var logs);

            (await client.IsBreachedAsync(Password)).Should().BeNull();
            AssertClean(logs);
        }

        [Fact]
        public async Task ANetworkError_ReturnsNull_AndLogsNoHashOrPassword()
        {
            var client = Build(new StubHandler(_ => throw new HttpRequestException("failed for range/" + Sha1(Password)[..5])), out var logs);

            (await client.IsBreachedAsync(Password)).Should().BeNull();
            AssertClean(logs);
        }

        [Fact]
        public async Task AnyOtherFailure_ReturnsNull()
        {
            var client = Build(new StubHandler(_ => throw new IOException("stream broke")), out var logs);

            (await client.IsBreachedAsync(Password)).Should().BeNull();
            AssertClean(logs);
        }

        [Fact]
        public async Task ATimeout_ReturnsNull()
        {
            var handler = new StubHandler(async (_, token) =>
            {
                await Task.Delay(TimeSpan.FromSeconds(30), token);
                return Respond(string.Empty);
            });
            var client = Build(handler, out var logs, TimeSpan.FromMilliseconds(50));

            (await client.IsBreachedAsync(Password)).Should().BeNull();
            AssertClean(logs);
        }

        [Fact]
        public async Task ACallerCancel_StillThrows()
        {
            var handler = new StubHandler(async (_, token) =>
            {
                await Task.Delay(TimeSpan.FromSeconds(30), token);
                return Respond(string.Empty);
            });
            var client = Build(handler, out _);
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

            var act = () => client.IsBreachedAsync(Password, cts.Token);

            await act.Should().ThrowAsync<OperationCanceledException>();
        }

        private static string Sha1(string value) =>
#pragma warning disable CA5350
            Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(value)));
#pragma warning restore CA5350

        private static HttpResponseMessage Respond(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body) };

        private static void AssertClean(List<string> logs)
        {
            var all = string.Join("\n", logs);
            all.Should().NotContain(Password).And.NotContainEquivalentOf(Sha1(Password)[..5]);
        }

        private static PwnedPasswordsClient Build(StubHandler handler, out List<string> logs, TimeSpan? timeout = null)
        {
            var options = new PasswordPolicyOptions { BreachCheckTimeout = timeout ?? TimeSpan.FromSeconds(2) };
            var http = new HttpClient(handler) { BaseAddress = options.BreachCheckBaseUrl };
            var captured = new List<string>();
            logs = captured;
            return new PwnedPasswordsClient(http, Options.Create(options), new ListLogger(captured));
        }

        private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
        {
            internal StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
                : this((request, _) => Task.FromResult(respond(request)))
            {
            }

            internal List<HttpRequestMessage> Requests { get; } = new();

            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                this.Requests.Add(request);
                return respond(request, cancellationToken);
            }
        }

        private sealed class ListLogger(List<string> sink) : ILogger<PwnedPasswordsClient>
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                sink.Add(formatter(state, exception) + exception);
            }
        }
    }
}
