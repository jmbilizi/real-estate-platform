// <copyright file="EmailConfirmationEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for Identity's <c>/account/register</c>, <c>/account/confirmEmail</c>,
    /// <c>/account/resendConfirmationEmail</c> and <c>/account/login</c> with this service's
    /// confirmation, non-enumeration, throttling and enforcement behaviour attached.
    /// </summary>
    public class EmailConfirmationEndpointTests
    {
        private const string Password = "Test1234!@#";
        private const string RegisterPath = "/account/register";
        private const string LoginPath = "/account/login";
        private const string ConfirmPath = "/account/confirmEmail";
        private const string ResendPath = "/account/resendConfirmationEmail";

        [Fact]
        public async Task Register_SendsAConfirmationLink_OnTheWebOrigin_ThatConfirmsTheAddress()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("confirm");

            await RegisterAsync(client, email);

            var sent = factory.ConfirmationLinks.Should().ContainSingle().Subject;
            sent.Email.Should().Be(email);
            var link = new Uri(sent.Credential);
            link.GetLeftPart(UriPartial.Authority).Should().Be(AccountServiceFactory.WebOrigin);
            link.AbsolutePath.Should().Be(AccountServiceFactory.ConfirmationPath);
            link.Query.Should().Contain("userId=").And.Contain("code=");
            sent.Composed.ReplyToAddress.Should().Be("contact@cribstop.com");

            (await IsConfirmedAsync(factory, email)).Should().BeFalse();

            using var confirm = await client.GetAsync(ConfirmPath + link.Query);
            confirm.StatusCode.Should().Be(HttpStatusCode.OK);
            (await confirm.Content.ReadAsStringAsync()).Should().Contain("confirming your email");
            (await IsConfirmedAsync(factory, email)).Should().BeTrue();
        }

        [Fact]
        public async Task ConfirmEmail_ReplayAfterSuccess_IsHarmless()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("replay");
            await RegisterAsync(client, email);
            var query = LinkQuery(factory, email);

            using var first = await client.GetAsync(ConfirmPath + query);
            using var second = await client.GetAsync(ConfirmPath + query);

            first.StatusCode.Should().Be(HttpStatusCode.OK);
            second.StatusCode.Should().Be(HttpStatusCode.OK);
            (await IsConfirmedAsync(factory, email)).Should().BeTrue();
        }

        [Fact]
        public async Task ConfirmEmail_RejectsAnExpiredLink_AgainstTheConfiguredLifetime()
        {
            // A negative lifetime makes every issued link already expired, with no sleeping.
            using var factory = new AccountRecoveryFactory(options =>
                options.ConfirmationTokenLifetime = TimeSpan.FromMilliseconds(1));
            using var client = factory.CreateClient();
            var email = NewEmail("expired");
            await RegisterAsync(client, email);

            using var confirm = await client.GetAsync(ConfirmPath + LinkQuery(factory, email));

            confirm.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await confirm.Content.ReadAsStringAsync()).Should().Contain(IdentityResponseShapingFilter.ConfirmationFailedDetail);
            (await IsConfirmedAsync(factory, email)).Should().BeFalse();
        }

        [Fact]
        public async Task ConfirmEmail_FailsTheSameWay_ForTamperedMalformedAndUnknown()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("tamper");
            await RegisterAsync(client, email);
            var query = LinkQuery(factory, email);

            using var tampered = await client.GetAsync(ConfirmPath + query[..^1] + (query[^1] == 'A' ? 'B' : 'A'));
            using var malformed = await client.GetAsync(ConfirmPath + query.Replace("code=", "code=%2A%2A", StringComparison.Ordinal));
            using var unknown = await client.GetAsync($"{ConfirmPath}?userId={Guid.NewGuid()}&code=abc");

            var tamperedBody = await tampered.Content.ReadAsStringAsync();
            tampered.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            malformed.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            unknown.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await malformed.Content.ReadAsStringAsync()).Should().Be(tamperedBody);
            (await unknown.Content.ReadAsStringAsync()).Should().Be(tamperedBody);
            tamperedBody.Should().Contain("Request a new link");
            (await IsConfirmedAsync(factory, email)).Should().BeFalse();
        }

        [Fact]
        public async Task Resend_AnswersIdentically_ForUnknownUnconfirmedAndConfirmedAddresses()
        {
            using var factory = new AccountRecoveryFactory(WithFloor);
            using var client = factory.CreateClient();
            var unconfirmed = NewEmail("resend-unconfirmed");
            var confirmed = NewEmail("resend-confirmed");
            await RegisterAsync(client, unconfirmed);
            await RegisterAndConfirmAsync(factory, client, confirmed);
            var linksBefore = factory.ConfirmationLinks.Count;

            var unknown = await PostTimedAsync(client, ResendPath, new { email = NewEmail("resend-unknown") });
            var forUnconfirmed = await PostTimedAsync(client, ResendPath, new { email = unconfirmed });
            var forConfirmed = await PostTimedAsync(client, ResendPath, new { email = confirmed });

            unknown.Status.Should().Be(HttpStatusCode.OK);
            forUnconfirmed.Status.Should().Be(HttpStatusCode.OK);
            forConfirmed.Status.Should().Be(HttpStatusCode.OK);
            forUnconfirmed.Body.Should().Be(unknown.Body);
            forConfirmed.Body.Should().Be(unknown.Body);
            AssertHeldToTheFloor(unknown.Elapsed, forUnconfirmed.Elapsed);
            AssertHeldToTheFloor(unknown.Elapsed, forConfirmed.Elapsed);

            // Identity mails every address that has an account, confirmed or not.
            factory.ConfirmationLinks.Should().HaveCount(linksBefore + 2);
        }

        [Fact]
        public async Task Resend_EnforcesTheMinimumInterval()
        {
            using var factory = new AccountRecoveryFactory(options => options.ResendMinimumInterval = TimeSpan.FromSeconds(60));
            using var client = factory.CreateClient();
            var email = NewEmail("interval");

            (await PostTimedAsync(client, ResendPath, new { email })).Status.Should().Be(HttpStatusCode.OK);
            var refused = await PostTimedAsync(client, ResendPath, new { email });

            refused.Status.Should().Be(HttpStatusCode.TooManyRequests);
            refused.RetryAfterSeconds.Should().BeInRange(55, 60);
        }

        [Fact]
        public async Task Resend_EnforcesTheHourlyLimit_PerAddress()
        {
            using var factory = new AccountRecoveryFactory(options => options.ResendsPerEmailPerHour = 2);
            using var client = factory.CreateClient();
            var email = NewEmail("hourly");

            (await PostTimedAsync(client, ResendPath, new { email })).Status.Should().Be(HttpStatusCode.OK);
            (await PostTimedAsync(client, ResendPath, new { email })).Status.Should().Be(HttpStatusCode.OK);
            var refused = await PostTimedAsync(client, ResendPath, new { email });

            refused.Status.Should().Be(HttpStatusCode.TooManyRequests);
            refused.RetryAfterSeconds.Should().BeGreaterThan(3000);

            (await PostTimedAsync(client, ResendPath, new { email = NewEmail("hourly-other") })).Status.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Resend_EnforcesThePerClientAddressLimit_FromXRealIp()
        {
            using var factory = new AccountRecoveryFactory(options => options.ResendsPerAddress = 1);
            using var client = factory.CreateClient();

            (await PostTimedAsync(client, ResendPath, new { email = NewEmail("a") }, "203.0.113.1")).Status.Should().Be(HttpStatusCode.OK);
            (await PostTimedAsync(client, ResendPath, new { email = NewEmail("b") }, "203.0.113.1")).Status.Should().Be(HttpStatusCode.TooManyRequests);
            (await PostTimedAsync(client, ResendPath, new { email = NewEmail("c") }, "203.0.113.2")).Status.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Register_DuplicateUnconfirmedAddress_AnswersLikeSuccess_AndSendsAFreshLink()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("dup-unconfirmed");

            var first = await PostTimedAsync(client, RegisterPath, new { email, password = Password });
            var second = await PostTimedAsync(client, RegisterPath, new { email, password = "Another9876!@#" });

            first.Status.Should().Be(HttpStatusCode.OK);
            second.Status.Should().Be(first.Status);
            second.Body.Should().Be(first.Body);
            (await AccountCountAsync(factory, email)).Should().Be(1);

            // The mailbox owner learns what happened. The caller does not.
            var links = factory.ConfirmationLinks.Where(m => m.Email == email).ToList();
            links.Should().HaveCount(2);
            using var confirm = await client.GetAsync(ConfirmPath + new Uri(links[1].Credential).Query);
            confirm.StatusCode.Should().Be(HttpStatusCode.OK);

            // The second password did not replace the first.
            using var login = await client.PostAsJsonAsync(LoginPath, new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);

            factory.Logs.Entries.Should().Contain(e => e.EventId.Id == 1363 && e.Message.Contains(email, StringComparison.Ordinal));
        }

        [Fact]
        public async Task Register_DuplicateConfirmedAddress_AnswersLikeSuccess_NotifiesTheMailboxInstead_AndLogsIt()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("dup-confirmed");
            await RegisterAndConfirmAsync(factory, client, email);
            var linksBefore = factory.ConfirmationLinks.Count;

            var duplicate = await PostTimedAsync(client, RegisterPath, new { email, password = Password });

            duplicate.Status.Should().Be(HttpStatusCode.OK);
            duplicate.Body.Should().BeEmpty();
            (await AccountCountAsync(factory, email)).Should().Be(1);

            // No new confirmation link — the caller's identical response cannot be a confirmation
            // resend. The mailbox owner is told by a different message instead (#138).
            factory.ConfirmationLinks.Should().HaveCount(linksBefore);
            var notice = factory.AlreadyRegisteredNotices.Should().ContainSingle().Subject;
            notice.To.Should().Be(email);
            notice.TextBody.Should().Contain("already exists");
            factory.Logs.Entries.Should().Contain(e => e.EventId.Id == 1362 && e.Message.Contains(email, StringComparison.Ordinal));
        }

        [Fact]
        public async Task Register_DuplicateAddress_IsHeldToTheFloor_LikeASuccess()
        {
            using var factory = new AccountRecoveryFactory(WithFloor);
            using var client = factory.CreateClient();
            var existing = NewEmail("floor-existing");
            await RegisterAsync(client, existing);

            var fresh = await PostTimedAsync(client, RegisterPath, new { email = NewEmail("floor-fresh"), password = Password });
            var duplicate = await PostTimedAsync(client, RegisterPath, new { email = existing, password = Password });

            fresh.Status.Should().Be(HttpStatusCode.OK);
            duplicate.Status.Should().Be(HttpStatusCode.OK);
            duplicate.Body.Should().Be(fresh.Body);
            AssertHeldToTheFloor(fresh.Elapsed, duplicate.Elapsed);
        }

        [Fact]
        public async Task Register_StillReportsPasswordPolicyAndMalformedAddressFailures()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var existing = NewEmail("weak-existing");
            await RegisterAsync(client, existing);

            var weakFresh = await PostTimedAsync(client, RegisterPath, new { email = NewEmail("weak-fresh"), password = "short" });
            var weakDuplicate = await PostTimedAsync(client, RegisterPath, new { email = existing, password = "short" });
            var malformed = await PostTimedAsync(client, RegisterPath, new { email = "not-an-address", password = Password });

            weakFresh.Status.Should().Be(HttpStatusCode.BadRequest);
            weakFresh.Body.Should().Contain("Password");

            // The policy fails before the duplicate check, so the two weak requests are identical.
            weakDuplicate.Status.Should().Be(HttpStatusCode.BadRequest);
            weakDuplicate.Body.Should().Be(weakFresh.Body);
            weakDuplicate.Body.Should().NotContain("Duplicate");

            malformed.Status.Should().Be(HttpStatusCode.BadRequest);
            malformed.Body.Should().Contain("InvalidEmail");
        }

        [Fact]
        public async Task Register_IsRateLimited_PerClientAddress()
        {
            using var factory = new AccountRecoveryFactory(options => options.RegistrationsPerAddress = 1);
            using var client = factory.CreateClient();

            (await PostTimedAsync(client, RegisterPath, new { email = NewEmail("limit-a"), password = Password })).Status.Should().Be(HttpStatusCode.OK);
            var refused = await PostTimedAsync(client, RegisterPath, new { email = NewEmail("limit-b"), password = Password });

            refused.Status.Should().Be(HttpStatusCode.TooManyRequests);
            refused.RetryAfterSeconds.Should().BePositive();
        }

        [Fact]
        public async Task Login_AllowsAnUnconfirmedAccount_WhileTheSwitchIsOff()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var email = NewEmail("switch-off");
            await RegisterAsync(client, email);

            using var login = await client.PostAsJsonAsync(LoginPath, new { email, password = Password });

            login.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.Logs.Entries.Should().ContainSingle(e => e.EventId.Id == 1364 && e.Level == LogLevel.Warning);
        }

        [Fact]
        public async Task Login_RefusesAnUnconfirmedAccount_WhenTheSwitchIsOn_LikeAWrongPassword()
        {
            using var factory = new AccountRecoveryFactory(options => options.RequireConfirmedEmail = true);
            using var client = factory.CreateClient();
            var email = NewEmail("switch-on");
            await RegisterAsync(client, email);

            var unconfirmed = await PostTimedAsync(client, LoginPath, new { email, password = Password });
            var wrongPassword = await PostTimedAsync(client, LoginPath, new { email, password = "Wrong1234!@#" });
            var unknown = await PostTimedAsync(client, LoginPath, new { email = NewEmail("nobody"), password = Password });

            unconfirmed.Status.Should().Be(HttpStatusCode.Unauthorized);
            wrongPassword.Status.Should().Be(HttpStatusCode.Unauthorized);
            unknown.Status.Should().Be(HttpStatusCode.Unauthorized);
            unconfirmed.Body.Should().Be(wrongPassword.Body);
            unknown.Body.Should().Be(wrongPassword.Body);
            unconfirmed.Body.Should().NotContain("NotAllowed");
            factory.Logs.Entries.Should().NotContain(e => e.EventId.Id == 1364);

            await ConfirmAsync(factory, client, email);
            using var allowed = await client.PostAsJsonAsync(LoginPath, new { email, password = Password });
            allowed.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Login_IsHeldToTheTimingFloor_SoTheCollapsedBodyIsNotUndoneByAStopwatch()
        {
            // An unknown address costs no password hash and a real account pays PBKDF2. Without
            // the floor the identical bodies are readable as a timing difference.
            using var factory = new AccountRecoveryFactory(options =>
                options.MinimumResponseDuration = TimeSpan.FromMilliseconds(400));
            using var client = factory.CreateClient();
            var email = NewEmail("login-floor");
            await RegisterAsync(client, email);

            var unknown = await PostTimedAsync(client, LoginPath, new { email = NewEmail("nobody"), password = Password });
            var wrongPassword = await PostTimedAsync(client, LoginPath, new { email, password = "Wrong1234!@#" });

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
            await RegisterAsync(client, locked);
            await RegisterAsync(client, reference);

            // Identity's default lockout: five failures.
            for (var attempt = 0; attempt < 5; attempt++)
            {
                using var failed = await client.PostAsJsonAsync(LoginPath, new { email = locked, password = "Wrong1234!@#" });
                failed.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            }

            var lockedOut = await PostTimedAsync(client, LoginPath, new { email = locked, password = Password });
            var wrongPassword = await PostTimedAsync(client, LoginPath, new { email = reference, password = "Wrong1234!@#" });

            lockedOut.Status.Should().Be(HttpStatusCode.Unauthorized);
            lockedOut.Body.Should().Be(wrongPassword.Body);
            lockedOut.Body.Should().NotContain("Lockedout");
        }

        [Fact]
        public async Task IdentityConfirmationEndpoints_ArePresent_InTheRouteTable_AndTheOpenApiDocument()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var patterns = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
                .OfType<RouteEndpoint>()
                .Select(endpoint => endpoint.RoutePattern.RawText)
                .ToList();
            patterns.Should().Contain(RegisterPath).And.Contain(ConfirmPath).And.Contain(ResendPath);

            var document = await client.GetStringAsync("/openapi/v1.json");
            document.Should().Contain(RegisterPath).And.Contain(ConfirmPath).And.Contain(ResendPath);
        }

        [Fact]
        public async Task EmailSender_ResolvesToThePostmarkTransport_WhichSuppressesSendingWithoutTheLink_WhenUnconfigured()
        {
            // The plain factory keeps the service's own sender and its real Postmark options,
            // which is the committed placeholder in tests. This exercises the fail-closed path
            // (#138), not a real send: delivery happens on the background queue, off the request,
            // so the log entry can land after the response — poll for it rather than assert
            // immediately.
            using var factory = new AccountServiceFactory();
            using var client = factory.CreateClient();
            using var scope = factory.Services.CreateScope();
            var email = NewEmail("undelivered");

            scope.ServiceProvider.GetRequiredService<IEmailSender<ApplicationUser>>()
                .Should().BeOfType<PostmarkEmailSender>();

            await RegisterAsync(client, email);

            var entry = await WaitForLogEntryAsync(factory, 1370);
            entry.Level.Should().Be(LogLevel.Warning);
            entry.Message.Should().Contain(email);
            entry.Message.Should().NotContain("code=");
            entry.Message.Should().NotContain("confirm-email");
        }

        [Fact]
        public void SenderIdentity_IsTheSettledConfiguration()
        {
            using var factory = new AccountServiceFactory();

            var sender = factory.Services.GetRequiredService<IOptions<TransactionalEmailOptions>>().Value;
            var recovery = factory.Services.GetRequiredService<IOptions<AccountRecoveryOptions>>().Value;

            sender.FromName.Should().Be("Cribstop (Real Broker, LLC)");
            sender.FromAddress.Should().Be("no-reply@cribstop.com");
            sender.ReplyToAddress.Should().Be("contact@cribstop.com");
            sender.BrokerageDisclosure.Should().Be("Cribstop is brokered by Real Broker, LLC.");
            recovery.ConfirmationPath.Should().Be("/confirm-email");
            recovery.ConfirmationTokenLifetime.Should().Be(TimeSpan.FromHours(24));
            recovery.RequireConfirmedEmail.Should().BeFalse();
        }

        [Fact]
        public async Task Filters_ApplyNoRateLimitToLoginOrConfirm()
        {
            using var factory = new AccountRecoveryFactory(options =>
            {
                options.RegistrationsPerAddress = 1;
                options.ResendsPerAddress = 1;
            });
            using var client = factory.CreateClient();
            var email = NewEmail("passthrough");
            await RegisterAsync(client, email);

            for (var attempt = 0; attempt < 4; attempt++)
            {
                using var login = await client.PostAsJsonAsync(LoginPath, new { email, password = Password });
                login.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // /confirmEmail has no request DTO. It is the case that would throw if the filters
            // indexed arguments instead of searching them.
            await ConfirmAsync(factory, client, email);

            (await PostTimedAsync(client, ResendPath, new { email })).Status.Should().Be(HttpStatusCode.OK);
            (await PostTimedAsync(client, ResendPath, new { email })).Status.Should().Be(HttpStatusCode.TooManyRequests);
        }

        private static void WithFloor(AccountRecoveryOptions options) =>
            options.MinimumResponseDuration = TimeSpan.FromMilliseconds(250);

        /// <summary>
        /// Polls <see cref="AccountServiceFactory.Logs"/> for an entry with the given event id.
        /// Delivery through <see cref="PostmarkDeliveryQueue"/> happens on a background loop, off
        /// the request that triggered it, so its log entry is not guaranteed to exist the instant
        /// the HTTP response returns.
        /// </summary>
        private static async Task<CapturingLoggerProvider.LogEntry> WaitForLogEntryAsync(
            AccountServiceFactory factory,
            int eventId)
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                var matches = factory.Logs.Entries.Where(e => e.EventId.Id == eventId).ToList();
                if (matches.Count > 0)
                {
                    return matches[0];
                }

                await Task.Delay(25);
            }

            throw new TimeoutException($"No log entry with event id {eventId} appeared within 5 seconds.");
        }

        /// <summary>
        /// Asserts both requests were held to the 250ms floor. The tolerance covers the gap between
        /// the timer wheel <c>Task.Delay</c> runs on and the <c>Stopwatch</c> that measures it.
        /// </summary>
        private static void AssertHeldToTheFloor(TimeSpan first, TimeSpan second)
        {
            var floor = TimeSpan.FromMilliseconds(250);
            var tolerance = TimeSpan.FromMilliseconds(25);

            first.Should().BeGreaterThanOrEqualTo(floor - tolerance);
            second.Should().BeGreaterThanOrEqualTo(floor - tolerance);
            (first - second).Duration().Should().BeLessThan(TimeSpan.FromMilliseconds(150));
        }

        private static string NewEmail(string prefix) => $"{prefix}-{Guid.NewGuid()}@example.com";

        private static string LinkQuery(AccountRecoveryFactory factory, string email) =>
            new Uri(factory.ConfirmationLinks.Last(m => m.Email == email).Credential).Query;

        private static async Task RegisterAsync(HttpClient client, string email)
        {
            using var response = await client.PostAsJsonAsync(RegisterPath, new { email, password = Password });
            response.EnsureSuccessStatusCode();
        }

        private static async Task ConfirmAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            using var response = await client.GetAsync(ConfirmPath + LinkQuery(factory, email));
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static async Task RegisterAndConfirmAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            await RegisterAsync(client, email);
            await ConfirmAsync(factory, client, email);
        }

        private static async Task<bool> IsConfirmedAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            user.Should().NotBeNull();
            return await users.IsEmailConfirmedAsync(user!);
        }

        private static async Task<int> AccountCountAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            return await db.Users.CountAsync(u => u.Email == email);
        }

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
