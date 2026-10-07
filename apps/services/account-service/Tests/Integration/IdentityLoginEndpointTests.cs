// <copyright file="IdentityLoginEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using AccountService.Configuration;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for Identity's <c>/account/login</c> with this service's
    /// non-enumeration and timing behaviour attached.
    /// </summary>
    public class IdentityLoginEndpointTests
    {
        private const string Password = "Test1234!@#Abcd";
        private const string LoginPath = "/account/login";

        [Fact]
        public async Task Login_IsHeldToTheTimingFloor_SoTheCollapsedBodyIsNotUndoneByAStopwatch()
        {
            // An unknown address costs no password hash and a real account pays PBKDF2. Without
            // the floor the identical bodies are readable as a timing difference.
            using var factory = new AccountRecoveryFactory(options =>
                options.MinimumResponseDuration = TimeSpan.FromMilliseconds(400));
            using var client = factory.CreateClient();
            var email = NewEmail("login-floor");
            await AuthHelper.SeedUserAsync(factory, email, Password);

            var unknown = await PostTimedAsync(client, LoginPath, new { email = NewEmail("nobody"), password = Password });
            var wrongPassword = await PostTimedAsync(client, LoginPath, new { email, password = "Wrong1234!@#Abc" });

            unknown.Status.Should().Be(HttpStatusCode.Unauthorized);
            wrongPassword.Status.Should().Be(HttpStatusCode.Unauthorized);
            unknown.Elapsed.Should().BeGreaterThan(TimeSpan.FromMilliseconds(350));
            wrongPassword.Elapsed.Should().BeGreaterThan(TimeSpan.FromMilliseconds(350));
        }

        [Fact]
        public async Task Login_AnswersALockedOutAccount_LikeAWrongPassword()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var locked = NewEmail("locked");
            var reference = NewEmail("reference");
            await AuthHelper.SeedUserAsync(factory, locked, Password);
            await AuthHelper.SeedUserAsync(factory, reference, Password);

            // Identity's default lockout: five failures.
            for (var attempt = 0; attempt < 5; attempt++)
            {
                using var failed = await client.PostAsJsonAsync(LoginPath, new { email = locked, password = "Wrong1234!@#Abc" });
                failed.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            }

            var lockedOut = await PostTimedAsync(client, LoginPath, new { email = locked, password = Password });
            var wrongPassword = await PostTimedAsync(client, LoginPath, new { email = reference, password = "Wrong1234!@#Abc" });

            lockedOut.Status.Should().Be(HttpStatusCode.Unauthorized);
            lockedOut.Body.Should().Be(wrongPassword.Body);
            lockedOut.Body.Should().NotContain("Lockedout");
        }

        [Fact]
        public void EmailSender_ResolvesToThePostmarkTransport()
        {
            using var factory = new AccountServiceFactory();
            using var scope = factory.Services.CreateScope();

            scope.ServiceProvider.GetRequiredService<IEmailSender<ApplicationUser>>()
                .Should().BeOfType<PostmarkEmailSender>();
        }

        [Fact]
        public void SenderIdentity_IsTheSettledConfiguration()
        {
            using var factory = new AccountServiceFactory();

            var sender = factory.Services.GetRequiredService<IOptions<TransactionalEmailOptions>>().Value;

            sender.FromName.Should().Be("Cribstop (Real Broker, LLC)");
            sender.FromAddress.Should().Be("no-reply@cribstop.com");
            sender.ReplyToAddress.Should().Be("contact@cribstop.com");
            sender.BrokerageDisclosure.Should().Be("Cribstop is brokered by Real Broker, LLC.");
        }

        [Fact]
        public async Task Filters_ApplyNoRateLimitToLogin()
        {
            using var factory = new AccountRecoveryFactory(options => options.SignUpSendsPerAddress = 1);
            using var client = factory.CreateClient();
            var email = NewEmail("passthrough");
            await AuthHelper.SeedUserAsync(factory, email, Password);

            for (var attempt = 0; attempt < 4; attempt++)
            {
                using var login = await client.PostAsJsonAsync(LoginPath, new { email, password = Password });
                login.StatusCode.Should().Be(HttpStatusCode.OK);
            }
        }

        private static string NewEmail(string prefix) => $"{prefix}-{Guid.NewGuid()}@example.com";

        private static async Task<TimedResponse> PostTimedAsync(HttpClient client, string path, object body, string? realIp = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
            if (realIp is not null)
            {
                request.Headers.Add("X-Real-IP", realIp);
            }

            var startedAt = Stopwatch.GetTimestamp();
            using var response = await client.SendAsync(request);
            var elapsed = Stopwatch.GetElapsedTime(startedAt);

            var retryAfter = response.Headers.RetryAfter?.Delta?.TotalSeconds ?? 0;
            return new TimedResponse(response.StatusCode, await response.Content.ReadAsStringAsync(), elapsed, retryAfter);
        }

        private sealed record TimedResponse(HttpStatusCode Status, string Body, TimeSpan Elapsed, double RetryAfterSeconds);
    }
}
