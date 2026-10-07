// <copyright file="EmailChangeEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the email change under <c>/account/email/change</c> (#660).
    /// </summary>
    /// <remarks>
    /// Each test owns a host, because the rate limiter counts per client address and per email.
    /// The in-memory provider enforces no unique index, so the database guard behind the in-transaction
    /// re-check has no test here. The race test covers the re-check.
    /// </remarks>
    public class EmailChangeEndpointTests
    {
        private const string StartPath = "/account/email/change/start";
        private const string VerifyPath = "/account/email/change/verify";
        private const string Password = "Old-passphrase-12345";
        private const string Old = "owner@example.com";
        private const string New = "fresh@example.com";

        [Fact]
        public async Task Start_WithThePassword_SendsACodeToTheNewAddressOnly_AndStoresOnePendingChange()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            var response = await client.PostAsJsonAsync(StartPath, new { newEmail = " Fresh@Example.com ", currentPassword = Password });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            body.TryGetProperty("stepUp", out _).Should().BeFalse();
            Codes(factory).Should().ContainSingle().Which.To.Should().Be("Fresh@Example.com");
            var pending = (await Pending(factory)).Should().ContainSingle().Subject;
            pending.NewEmail.Should().Be("Fresh@Example.com");
            pending.ExpiresAt.Should().BeCloseTo(DateTime.UtcNow + TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(1));
        }

        [Fact]
        public async Task Verify_SwapsEmailAndUserName_KeepsItConfirmed_AndWritesTheAuditAndRestoreRows()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            var stampBefore = await StampAsync(factory, id);
            await StartAsync(client, factory);

            var response = await client.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, New) });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(New);
            user.UserName.Should().Be(New);
            user.NormalizedEmail.Should().Be("FRESH@EXAMPLE.COM");
            user.NormalizedUserName.Should().Be("FRESH@EXAMPLE.COM");
            user.EmailConfirmed.Should().BeTrue();
            user.SecurityStamp.Should().NotBe(stampBefore);
            (await Pending(factory)).Should().BeEmpty();

            var key = factory.Services.GetRequiredService<IOptions<EmailCodeOptions>>().Value.HmacKey;
            var changed = (await Events(factory)).Should().ContainSingle().Subject;
            changed.Kind.Should().Be(AccountSecurityEvent.EmailChanged);
            changed.UserId.Should().Be(id);
            changed.OldEmailHash.Should().Be(AuditHash.Of(AuditHash.Email, "OWNER@EXAMPLE.COM", key));
            changed.NewEmailHash.Should().Be(AuditHash.Of(AuditHash.Email, "FRESH@EXAMPLE.COM", key));
            changed.OldEmailHash.Should().NotBe(changed.NewEmailHash);
            JsonSerializer.Serialize(changed).Should().NotContainEquivalentOf("example.com");

            var restore = (await Restores(factory)).Should().ContainSingle().Subject;
            restore.UserId.Should().Be(id);
            restore.OldEmail.Should().Be(Old);
            (restore.RestoreUntil - restore.ChangedAt).Should().Be(TimeSpan.FromDays(7));
            restore.ConsumedAt.Should().BeNull();
        }

        [Fact]
        public async Task Verify_OfAnUnconfirmedAccount_LeavesTheNewAddressConfirmed()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old, confirmed: false);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);

            (await client.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, New) })).StatusCode.Should().Be(HttpStatusCode.OK);

            (await UserAsync(factory, id)).EmailConfirmed.Should().BeTrue();
        }

        [Fact]
        public async Task Verify_EndsOtherSessions_AndKeepsTheCurrentCookieSessionAlive()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var current = await SignInAsync(factory, Old);
            using var other = await SignInAsync(factory, Old);
            (await other.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
            await StartAsync(current, factory);

            (await current.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, New) })).StatusCode.Should().Be(HttpStatusCode.OK);

            var profile = await current.GetAsync("/account/profile");
            profile.StatusCode.Should().Be(HttpStatusCode.OK);
            (await profile.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("email").GetString().Should().Be(New);
            (await other.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Verify_ForABearerSession_IssuesANewToken_AndRevokesTheOldOneAndOtherTokens()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var anonymous = factory.CreateClient();
            var current = await BearerAsync(anonymous, Old);
            var other = await BearerAsync(anonymous, Old);
            (await StartAsync(anonymous, factory, current)).StatusCode.Should().Be(HttpStatusCode.OK);

            var response = await PostWithBearerAsync(anonymous, VerifyPath, new { code = CodeFor(factory, New) }, current);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var fresh = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
            (await ProfileAsync(anonymous, fresh)).StatusCode.Should().Be(HttpStatusCode.OK);
            (await ProfileAsync(anonymous, current)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await ProfileAsync(anonymous, other)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Verify_WithAWrongCode_Counts_ThenLocks_AndChangesNothing()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);
            var wrong = CodeFor(factory, New) == "000000" ? "000001" : "000000";

            var seen = await WrongTriesAsync(client, wrong);

            seen.Should().Equal("400:4", "400:3", "400:2", "400:1", "429:900");
            (await UserAsync(factory, id)).Email.Should().Be(Old);

            var right = await client.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, New) });
            right.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            (await UserAsync(factory, id)).Email.Should().Be(Old);
        }

        [Fact]
        public async Task Start_WithAWrongPassword_IsRefused_SendsNothing_AndCountsTowardTheLock()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            var seen = new List<HttpStatusCode>();
            for (var i = 0; i < 5; i++)
            {
                var response = await client.PostAsJsonAsync(StartPath, new { newEmail = New, currentPassword = "wrong-passphrase-1" });
                seen.Add(response.StatusCode);
                if (i == 0)
                {
                    (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("step_up_failed");
                }
            }

            seen.Should().AllBeEquivalentTo(HttpStatusCode.Forbidden);
            var locked = await client.PostAsJsonAsync(StartPath, new { newEmail = New, currentPassword = Password });
            locked.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            locked.Headers.Contains("Retry-After").Should().BeTrue();
            Codes(factory).Should().BeEmpty();
            (await Pending(factory)).Should().BeEmpty();
            (await UserAsync(factory, id)).Email.Should().Be(Old);
        }

        [Fact]
        public async Task Start_WithNoPassword_SendsAStepUpCodeToTheOldAddress_ThenTheCodeOpensTheChange()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            var first = await client.PostAsJsonAsync(StartPath, new { newEmail = New });

            first.StatusCode.Should().Be(HttpStatusCode.OK);
            (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("stepUp").GetString().Should().Be("oldEmailCode");
            Codes(factory).Should().ContainSingle().Which.To.Should().Be(Old);
            (await Pending(factory)).Should().BeEmpty();

            var second = await client.PostAsJsonAsync(StartPath, new { newEmail = New, oldEmailCode = CodeFor(factory, Old) });

            second.StatusCode.Should().Be(HttpStatusCode.OK);
            (await second.Content.ReadFromJsonAsync<JsonElement>()).TryGetProperty("stepUp", out _).Should().BeFalse();
            Codes(factory).Last().To.Should().Be(New);
            (await Pending(factory)).Should().ContainSingle();
        }

        [Fact]
        public async Task Start_WithAWrongOldEmailCode_IsRefusedWithTheTriesLeft_AndStoresNothing()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            (await client.PostAsJsonAsync(StartPath, new { newEmail = New })).StatusCode.Should().Be(HttpStatusCode.OK);
            var wrong = CodeFor(factory, Old) == "000000" ? "000001" : "000000";

            var response = await client.PostAsJsonAsync(StartPath, new { newEmail = New, oldEmailCode = wrong });

            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("step_up_failed");
            body.GetProperty("attemptsLeft").GetInt32().Should().Be(4);
            Codes(factory).Should().ContainSingle();
            (await Pending(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Start_AnswersTheSame_ForATakenAddressAndAFreeOne_AndSendsOnlyToTheFreeOne()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            await CreateAccountAsync(factory, "taken@example.com");
            await CreateAccountAsync(factory, "gone@example.com", deleted: true);
            using var client = await SignInAsync(factory, Old);
            var seen = new List<string>();

            foreach (var address in new[] { New, "Taken@Example.com", "gone@example.com", Old })
            {
                var response = await client.PostAsJsonAsync(StartPath, new { newEmail = address, currentPassword = Password });
                seen.Add($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
            }

            seen.Distinct().Should().ContainSingle();
            Codes(factory).Should().ContainSingle().Which.To.Should().Be(New);
        }

        [Fact]
        public async Task Verify_AnswersTheSame_ForATakenAddressAndAFreeOne()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, "free.owner@example.com");
            await CreateAccountAsync(factory, "taken.owner@example.com");
            await CreateAccountAsync(factory, "taken@example.com");
            using var freeClient = await SignInAsync(factory, "free.owner@example.com");
            using var takenClient = await SignInAsync(factory, "taken.owner@example.com");
            (await freeClient.PostAsJsonAsync(StartPath, new { newEmail = New, currentPassword = Password })).EnsureSuccessStatusCode();
            (await takenClient.PostAsJsonAsync(StartPath, new { newEmail = "taken@example.com", currentPassword = Password })).EnsureSuccessStatusCode();
            var wrong = CodeFor(factory, New) == "000000" ? "000001" : "000000";

            var free = await WrongTriesAsync(freeClient, wrong);
            var taken = await WrongTriesAsync(takenClient, wrong);

            taken.Should().Equal(free);
        }

        [Fact]
        public async Task Verify_FailsNeutrally_WhenTheAddressIsTakenAfterStart_AndChangesNothing()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);
            await CreateAccountAsync(factory, "FRESH@example.com");

            var response = await client.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, New) });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("invalid_code");
            body.TryGetProperty("attemptsLeft", out var left).Should().BeFalse(left.ToString());
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(Old);
            user.UserName.Should().Be(Old);
            (await Events(factory)).Should().BeEmpty();
            (await Restores(factory)).Should().BeEmpty();
            (await Pending(factory)).Should().BeEmpty();
            (await client.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Verify_AfterThePendingChangeExpires_Fails_AndThePurgeRemovesTheRow()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);
            var code = CodeFor(factory, New);

            clock.Advance(TimeSpan.FromMinutes(31));
            var response = await client.PostAsJsonAsync(VerifyPath, new { code });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await UserAsync(factory, id)).Email.Should().Be(Old);
            using var scope = factory.Services.CreateScope();
            (await scope.ServiceProvider.GetRequiredService<EmailChangeService>().PurgeAsync()).Should().Be(1);
            (await Pending(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Verify_WithNoPendingChange_IsRefused()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            var response = await client.PostAsJsonAsync(VerifyPath, new { code = "123456" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Start_Again_ReplacesThePendingChange_AndVoidsTheEarlierCode()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);
            var firstCode = CodeFor(factory, New);
            (await client.PostAsJsonAsync(StartPath, new { newEmail = "second@example.com", currentPassword = Password })).EnsureSuccessStatusCode();

            (await Pending(factory)).Should().ContainSingle().Which.NewEmail.Should().Be("second@example.com");
            (await client.PostAsJsonAsync(VerifyPath, new { code = firstCode })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await UserAsync(factory, id)).Email.Should().Be(Old);

            (await client.PostAsJsonAsync(VerifyPath, new { code = CodeFor(factory, "second@example.com") })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await UserAsync(factory, id)).Email.Should().Be("second@example.com");
        }

        [Theory]
        [InlineData("")]
        [InlineData("not-an-email")]
        [InlineData("a@b")]
        [InlineData("o'brien@example.com")]
        public async Task Start_RefusesABadAddress_BeforeStepUp_WithNothingSent(string newEmail)
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            var response = await client.PostAsJsonAsync(StartPath, new { newEmail, currentPassword = Password });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("invalid_email");
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task BothSteps_RefuseAnAnonymousCaller()
        {
            using var factory = NoCooldown();
            using var anonymous = factory.CreateClient();

            (await anonymous.PostAsJsonAsync(StartPath, new { newEmail = New, currentPassword = Password })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await anonymous.PostAsJsonAsync(VerifyPath, new { code = "123456" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task BothSteps_RefuseAnApiKey()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            var created = await client.PostAsJsonAsync("/account/api-keys", new { name = "Key" });
            var rawKey = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("key").GetString();
            using var keyClient = factory.CreateClient();
            keyClient.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var start = await keyClient.PostAsJsonAsync(StartPath, new { newEmail = New, currentPassword = Password });
            var verify = await keyClient.PostAsJsonAsync(VerifyPath, new { code = "123456" });

            start.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            verify.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task TheFlow_LogsNoEmailAndNoCode()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await StartAsync(client, factory);
            var code = CodeFor(factory, New);
            await client.PostAsJsonAsync(VerifyPath, new { code = code == "000000" ? "000001" : "000000" });
            await client.PostAsJsonAsync(VerifyPath, new { code });

            var logged = string.Join('\n', factory.Logs.Entries.Select(e => e.Message));

            logged.Should().NotContainEquivalentOf("fresh@example");
            logged.Should().NotContainEquivalentOf("owner@example");
            logged.Should().NotContain(code);
            logged.Should().NotContain(Password);
        }

        private static AccountRecoveryFactory NoCooldown(TimeProvider? clock = null) =>
            new(
                configureCodes: c =>
                {
                    c.ResendCooldown = TimeSpan.Zero;
                    c.MaxPerHour = 100;
                    c.MaxPerDay = 100;
                },
                clock: clock);

        private static List<OutboundEmail> Codes(AccountRecoveryFactory factory) =>
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).ToList();

        private static string CodeFor(AccountRecoveryFactory factory, string to) =>
            Codes(factory).Last(m => string.Equals(m.To, to, StringComparison.OrdinalIgnoreCase)).Subject.Split(' ')[0];

        private static async Task<HttpResponseMessage> StartAsync(HttpClient client, AccountRecoveryFactory factory, string? bearer = null)
        {
            var body = new { newEmail = New, currentPassword = Password };
            var response = bearer is null
                ? await client.PostAsJsonAsync(StartPath, body)
                : await PostWithBearerAsync(client, StartPath, body, bearer);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            Codes(factory).Should().NotBeEmpty();
            return response;
        }

        private static async Task<HttpResponseMessage> PostWithBearerAsync(HttpClient client, string path, object body, string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return await client.SendAsync(request);
        }

        private static async Task<HttpResponseMessage> ProfileAsync(HttpClient client, string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/account/profile");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return await client.SendAsync(request);
        }

        private static async Task<string> BearerAsync(HttpClient client, string email)
        {
            var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        }

        private static async Task<HttpClient> SignInAsync(AccountRecoveryFactory factory, string email)
        {
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            (await client.PostAsJsonAsync("/account/login?useCookies=true", new { email, password = Password })).EnsureSuccessStatusCode();
            return client;
        }

        private static async Task<List<string>> WrongTriesAsync(HttpClient client, string wrong)
        {
            var result = new List<string>();
            for (var i = 0; i < 5; i++)
            {
                var response = await client.PostAsJsonAsync(VerifyPath, new { code = wrong });
                if (response.StatusCode == HttpStatusCode.BadRequest)
                {
                    var left = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attemptsLeft").GetInt32();
                    result.Add($"400:{left}");
                }
                else
                {
                    var retry = int.Parse(response.Headers.GetValues("Retry-After").Single(), CultureInfo.InvariantCulture);
                    result.Add($"{(int)response.StatusCode}:{retry}");
                }
            }

            return result;
        }

        private static async Task<string> CreateAccountAsync(
            AccountRecoveryFactory factory,
            string email,
            bool confirmed = true,
            bool deleted = false)
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
            (await manager.CreateAsync(user, Password)).Succeeded.Should().BeTrue();
            return user.Id;
        }

        private static async Task<ApplicationUser> UserAsync(AccountRecoveryFactory factory, string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking().SingleAsync(u => u.Id == id);
        }

        private static async Task<string?> StampAsync(AccountRecoveryFactory factory, string id) =>
            (await UserAsync(factory, id)).SecurityStamp;

        private static async Task<List<PendingEmailChange>> Pending(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().PendingEmailChanges.AsNoTracking().ToListAsync();
        }

        private static async Task<List<EmailChangeRestore>> Restores(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().EmailChangeRestores.AsNoTracking().ToListAsync();
        }

        private static async Task<List<AccountSecurityEvent>> Events(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().AccountSecurityEvents.AsNoTracking().ToListAsync();
        }
    }
}
