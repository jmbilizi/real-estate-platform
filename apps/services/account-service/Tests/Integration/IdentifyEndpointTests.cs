// <copyright file="IdentifyEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for <c>POST /account/identify</c> (#653).
    /// </summary>
    /// <remarks>
    /// Each test owns a host, because the rate limiter counts per client address and per email.
    /// </remarks>
    public class IdentifyEndpointTests
    {
        private const string Path = "/account/identify";

        [Fact]
        public async Task ConfirmedActiveAccount_RoutesToPassword_AndSendsNothing()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            var response = await Post(client, new { email = " Known@Example.com " });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("next").GetString().Should().Be("password");
            factory.AlreadyRegisteredNotices.Should().BeEmpty();
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task NewAddress_RoutesToCode_StartsSignUp_AndReturnsTheTimings()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, new { email = "New.Person@Example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("next").GetString().Should().Be("code");
            body.GetProperty("resendAfterSeconds").GetInt32().Should().Be(60);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            (await Rows(factory)).Should().ContainSingle().Which.Email.Should().Be("NEW.PERSON@EXAMPLE.COM");
            factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.Code);
        }

        [Fact]
        public async Task BothRoutes_ReturnTheSameJsonShape()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            var password = await (await Post(client, new { email = "known@example.com" })).Content.ReadFromJsonAsync<JsonElement>();
            var code = await (await Post(client, new { email = "free@example.com" })).Content.ReadFromJsonAsync<JsonElement>();

            Names(password).Should().Equal(Names(code));
        }

        [Fact]
        public async Task SoftDeletedAccount_RoutesToCode()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "gone@example.com", deleted: true);

            var response = await Post(client, new { email = "gone@example.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("next").GetString().Should().Be("code");
        }

        [Fact]
        public async Task UnconfirmedAccount_RoutesToCode()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "unconfirmed@example.com", confirmed: false);

            var response = await Post(client, new { email = "unconfirmed@example.com" });

            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("next").GetString().Should().Be("code");
        }

        [Fact]
        public async Task PendingAddress_InsideTheCooldown_StillAnswersCode_NotTooManyRequests()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var first = await Post(client, new { email = "pending@example.com" });
            var second = await Post(client, new { email = "pending@example.com" });

            second.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await second.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("next").GetString().Should().Be("code");
            body.GetProperty("resendAfterSeconds").GetInt32().Should().BeInRange(1, 60);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            first.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).Should().ContainSingle();
        }

        [Fact]
        public async Task UnconfirmedAccount_GetsOneNoticeInsideTheCooldown_NotOnePerCall()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "unconfirmed@example.com", confirmed: false);

            for (var i = 0; i < 4; i++)
            {
                (await Post(client, new { email = "unconfirmed@example.com" }, $"10.2.0.{i}")).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.AlreadyRegistered);
        }

        [Fact]
        public async Task WithNoCodeKey_EveryAddressAnswersServiceUnavailable()
        {
            using var factory = new AccountRecoveryFactory(configureCodes: c => c.HmacKey = string.Empty);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            (await Post(client, new { email = "known@example.com" })).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            (await Post(client, new { email = "free@example.com" })).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        }

        [Theory]
        [InlineData("")]
        [InlineData("nope")]
        [InlineData("a@b")]
        [InlineData("Name <a@example.com>")]
        public async Task BadAddress_Answers400_WithNoRowAndNoMessage(string email)
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, new { email });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("invalid_email");
            (await Rows(factory)).Should().BeEmpty();
            factory.AlreadyRegisteredNotices.Should().BeEmpty();
        }

        [Fact]
        public async Task PerEmailLimit_RefusesTheSixthCall_WithRetryAfter_ForEveryRoute()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            for (var i = 0; i < 5; i++)
            {
                (await Post(client, new { email = "known@example.com" }, $"10.0.0.{i}")).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            var refused = await Post(client, new { email = "KNOWN@example.com" }, "10.0.0.99");

            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            int.Parse(refused.Headers.GetValues("Retry-After").Single(), CultureInfo.InvariantCulture).Should().BeInRange(1, 900);
        }

        [Fact]
        public async Task PerEmailLimit_AppliesToANewAddressToo()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            for (var i = 0; i < 5; i++)
            {
                (await Post(client, new { email = "free@example.com" }, $"10.0.1.{i}")).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            (await Post(client, new { email = "free@example.com" }, "10.0.1.99")).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task PerClientAddressLimit_RefusesThe21stCall_AndCountsBadAddressesToo()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            for (var i = 0; i < 10; i++)
            {
                (await Post(client, new { email = $"person{i}@example.com" }, "203.0.113.7")).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            for (var i = 0; i < 10; i++)
            {
                (await Post(client, new { email = "bad" }, "203.0.113.7")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            }

            var refused = await Post(client, new { email = "another@example.com" }, "203.0.113.7");

            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.Contains("Retry-After").Should().BeTrue();
            (await Post(client, new { email = "another@example.com" }, "203.0.113.8")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task AClientAddressAtItsLimit_DoesNotSpendAVictimsEmailBudget()
        {
            using var factory = new AccountRecoveryFactory(options => options.IdentifiesPerAddress = 1);
            using var client = factory.CreateClient();

            await Post(client, new { email = "other@example.com" }, "198.51.100.1");
            for (var i = 0; i < 10; i++)
            {
                (await Post(client, new { email = "victim@example.com" }, "198.51.100.1")).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            }

            for (var i = 0; i < 5; i++)
            {
                (await Post(client, new { email = "victim@example.com" }, $"198.51.100.{20 + i}")).StatusCode.Should().Be(HttpStatusCode.OK);
            }
        }

        [Fact]
        public async Task EveryOutcome_HoldsTheTimingFloor()
        {
            var floor = TimeSpan.FromMilliseconds(250);
            using var factory = new AccountRecoveryFactory(options => options.MinimumResponseDuration = floor);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            await CreateAccountAsync(factory, "gone@example.com", deleted: true);
            await Post(client, new { email = "pending@example.com" }, "10.9.0.1");

            foreach (var email in new[]
            {
                "known@example.com",
                "free@example.com",
                "gone@example.com",
                "pending@example.com",
                "bad",
            })
            {
                var watch = Stopwatch.StartNew();
                await Post(client, new { email }, "10.9.0.2");
                watch.Stop();

                watch.Elapsed.Should().BeGreaterThanOrEqualTo(floor - TimeSpan.FromMilliseconds(30), $"{email} must not answer faster than the floor");
            }
        }

        [Fact]
        public async Task NothingLogsTheEmail()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known.secret@example.com");

            await Post(client, new { email = "known.secret@example.com" });
            await Post(client, new { email = "new.secret@example.com" });
            await Post(client, new { email = "new.secret@example.com" });
            await Post(client, new { email = "bad.secret" });

            var logged = string.Join("\n", factory.Logs.Entries.Select(e => e.Message));
            logged.Should().NotContainEquivalentOf("known.secret");
            logged.Should().NotContainEquivalentOf("new.secret");
            logged.Should().NotContainEquivalentOf("bad.secret");
        }

        private static List<string> Names(JsonElement element) =>
            element.EnumerateObject().Select(p => $"{p.Name}:{p.Value.ValueKind}").OrderBy(s => s, StringComparer.Ordinal).ToList();

        private static async Task<HttpResponseMessage> Post(HttpClient client, object body, string? address = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Path) { Content = JsonContent.Create(body) };
            if (address is not null)
            {
                request.Headers.Add("X-Real-IP", address);
            }

            return await client.SendAsync(request);
        }

        private static async Task<List<PendingRegistration>> Rows(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .PendingRegistrations.AsNoTracking().ToListAsync();
        }

        private static async Task CreateAccountAsync(AccountRecoveryFactory factory, string email, bool confirmed = true, bool deleted = false)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser
            {
                UserName = email,
                Email = email,
                EmailConfirmed = confirmed,
                DeletedAt = deleted ? DateTime.UtcNow : null,
            };
            var result = await manager.CreateAsync(user, "Test1234!@#Abcd");
            result.Succeeded.Should().BeTrue();
        }
    }
}
