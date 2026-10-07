// <copyright file="PasswordResetEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for password reset by code under <c>/account/password/reset</c> (#658).
    /// </summary>
    /// <remarks>
    /// Each test owns a host, because the rate limiter counts per client address and per email.
    /// </remarks>
    public class PasswordResetEndpointTests
    {
        private const string StartPath = "/account/password/reset/start";
        private const string VerifyPath = "/account/password/reset/verify";
        private const string CompletePath = "/account/password/reset/complete";
        private const string OldPassword = "Old-passphrase-12345";
        private const string NewPassword = "new correct horse battery";

        [Fact]
        public async Task Start_ForAUsableAccount_SendsACodeToIt_AndReturnsTheTimings()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "Owner@Example.com");

            var response = await Post(client, StartPath, new { email = "  owner@example.com " });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("resendAfterSeconds").GetInt32().Should().Be(0);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            var message = Codes(factory).Should().ContainSingle().Subject;
            message.To.Should().Be("Owner@Example.com");
            message.Subject.Should().MatchRegex(@"^\d{6} is your Cribstop code$");
        }

        [Fact]
        public async Task Start_AnswersTheSame_ForKnownUnknownUnconfirmedAndDeletedAddresses_AndSendsOnlyToTheKnown()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            await CreateAccountAsync(factory, "unconfirmed@example.com", confirmed: false);
            await CreateAccountAsync(factory, "deleted@example.com", deleted: true);
            var seen = new List<string>();

            foreach (var email in new[] { "known@example.com", "nobody@example.com", "unconfirmed@example.com", "deleted@example.com" })
            {
                var response = await Post(client, StartPath, new { email });
                seen.Add($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
            }

            seen.Distinct().Should().ContainSingle();
            Codes(factory).Should().ContainSingle().Which.To.Should().Be("known@example.com");
            (await EmailCodeCount(factory)).Should().Be(1);
        }

        [Fact]
        public async Task Start_HoldsTheTimingFloor_ForEveryKindOfAddress()
        {
            var floor = TimeSpan.FromMilliseconds(250);
            using var factory = new AccountRecoveryFactory(options => options.MinimumResponseDuration = floor);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            await CreateAccountAsync(factory, "unconfirmed@example.com", confirmed: false);
            await CreateAccountAsync(factory, "deleted@example.com", deleted: true);

            foreach (var email in new[] { "known@example.com", "nobody@example.com", "unconfirmed@example.com", "deleted@example.com" })
            {
                var watch = Stopwatch.StartNew();
                await Post(client, StartPath, new { email });
                watch.Stop();

                watch.Elapsed.Should().BeGreaterThanOrEqualTo(floor - TimeSpan.FromMilliseconds(30), email);
            }
        }

        [Theory]
        [InlineData("")]
        [InlineData("not-an-email")]
        [InlineData("a@b")]
        public async Task Start_RefusesABadAddress_WithNothingSent(string email)
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();

            var response = await Post(client, StartPath, new { email });

            await AssertErrorAsync(response, HttpStatusCode.BadRequest, "invalid_email");
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task Start_InsideTheCooldown_AnswersTooManyRequests_ForKnownAndUnknownAlike()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            var seen = new List<(HttpStatusCode, bool)>();

            foreach (var email in new[] { "known@example.com", "nobody@example.com" })
            {
                (await Post(client, StartPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
                var second = await Post(client, StartPath, new { email });
                seen.Add((second.StatusCode, second.Headers.Contains("Retry-After")));
            }

            seen.Should().OnlyContain(s => s.Item1 == HttpStatusCode.TooManyRequests && s.Item2);
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task Start_LimitsPerClientAddress_AcrossEmails()
        {
            using var factory = new AccountRecoveryFactory(options => options.SignUpSendsPerAddress = 2);
            using var client = factory.CreateClient();

            (await Post(client, StartPath, new { email = "a@example.com" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, StartPath, new { email = "b@example.com" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, StartPath, new { email = "c@example.com" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            (await Post(client, StartPath, new { email = "c@example.com" }, "10.0.0.2")).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task StartLimits_DoNotSpendTheSignUpCounters_AndTheOtherWayAround()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            (await Post(client, "/account/signup/start", new { email = "known@example.com" })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, StartPath, new { email = "known@example.com" })).StatusCode.Should().Be(HttpStatusCode.OK);

            Codes(factory).Should().ContainSingle(m => m.Kind == EmailKind.Code);
        }

        [Fact]
        public async Task Verify_ARightCode_ReturnsAOneTimeProofThatLives15Minutes()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await Post(client, StartPath, new { email = "owner@example.com" });

            var response = await Post(client, VerifyPath, new { email = "OWNER@example.com", code = CodeOf(factory) });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("resetProof").GetString().Should().NotBeNullOrWhiteSpace().And.HaveLength(43);
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(900);
            body.TryGetProperty("signupProof", out _).Should().BeFalse();
            var row = (await Proofs(factory)).Should().ContainSingle().Subject;
            row.Email.Should().Be("OWNER@EXAMPLE.COM");
            row.ConsumedAt.Should().BeNull();
            row.ExpiresAt.Should().BeCloseTo(DateTime.UtcNow.AddMinutes(15), TimeSpan.FromSeconds(30));
        }

        [Fact]
        public async Task Verify_StoresAHashOfTheProof_NeverTheProof()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            var row = (await Proofs(factory)).Should().ContainSingle().Subject;

            System.Text.Encoding.UTF8.GetString(row.ProofHash).Should().NotContain(proof);
            row.ProofHash.Should().HaveCount(32);
        }

        [Fact]
        public async Task Verify_AProofWorksFor15Minutes_ThenStops()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            clock.Advance(TimeSpan.FromMinutes(15) + TimeSpan.FromSeconds(1));
            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            await AssertPasswordUnchangedAsync(client, "owner@example.com");
        }

        [Fact]
        public async Task Verify_ACodeWorksOnce()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await Post(client, StartPath, new { email = "owner@example.com" });
            var code = CodeOf(factory);

            (await Post(client, VerifyPath, new { email = "owner@example.com", code })).StatusCode.Should().Be(HttpStatusCode.OK);
            var again = await Post(client, VerifyPath, new { email = "owner@example.com", code });

            again.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Verify_ACodeExpiresAfterTenMinutes()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await Post(client, StartPath, new { email = "owner@example.com" });
            var code = CodeOf(factory);

            clock.Advance(TimeSpan.FromMinutes(10) + TimeSpan.FromSeconds(1));
            var response = await Post(client, VerifyPath, new { email = "owner@example.com", code });

            await AssertErrorAsync(response, HttpStatusCode.BadRequest, "invalid_code");
        }

        [Fact]
        public async Task Verify_ASignUpCodeDoesNotVerifyForReset()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await Post(client, "/account/signup/start", new { email = "owner@example.com" });

            var response = await Post(client, VerifyPath, new { email = "owner@example.com", code = "000000" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task Verify_WrongCodes_ReturnTheTriesLeft_ThenLock_AndMatchForAnUnknownAddress()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            await Post(client, StartPath, new { email = "known@example.com" });
            var code = CodeOf(factory);

            var known = await WrongTriesAsync(client, "known@example.com", code);
            var unknown = await WrongTriesAsync(client, "nobody@example.com", code);

            known.Take(4).Should().Equal("400:4", "400:3", "400:2", "400:1");
            known[4].Should().StartWith("429:");
            unknown.Should().HaveCount(5);
            unknown.Take(4).Should().Equal(known.Take(4));
            unknown[4].Should().StartWith("429:");
            var knownRetry = int.Parse(known[4].Split(':')[1], CultureInfo.InvariantCulture);
            knownRetry.Should().BeInRange(890, 900);
        }

        [Fact]
        public async Task Verify_AfterTheLock_ARightCodeStillFails_AndStartIsLimited()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");
            await Post(client, StartPath, new { email = "known@example.com" });
            var code = CodeOf(factory);
            await WrongTriesAsync(client, "known@example.com", code);

            var verify = await Post(client, VerifyPath, new { email = "known@example.com", code });
            var start = await Post(client, StartPath, new { email = "known@example.com" });

            verify.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            start.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            (await Proofs(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Verify_AnswersTheSame_ForUnknownUnconfirmedAndDeletedAddresses()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "unconfirmed@example.com", confirmed: false);
            await CreateAccountAsync(factory, "deleted@example.com", deleted: true);
            var seen = new List<string>();

            foreach (var email in new[] { "nobody@example.com", "unconfirmed@example.com", "deleted@example.com" })
            {
                var response = await Post(client, VerifyPath, new { email, code = "123456" });
                seen.Add($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
            }

            seen.Distinct().Should().ContainSingle().Which.Should().Contain("\"attemptsLeft\":4");
            (await Proofs(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Verify_LimitsPerClientAddress_SoOneAddressCannotLockManyEmails()
        {
            using var factory = new AccountRecoveryFactory(options => options.SignUpVerifiesPerAddress = 2);
            using var client = factory.CreateClient();

            (await Post(client, VerifyPath, new { email = "a@example.com", code = "111111" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Post(client, VerifyPath, new { email = "b@example.com", code = "111111" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Post(client, VerifyPath, new { email = "c@example.com", code = "111111" }, "10.0.0.1")).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        }

        [Fact]
        public async Task Complete_SetsThePassword_ClearsTheLockout_AndRotatesTheStamp()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await LockOutAsync(factory, "owner@example.com");
            var stampBefore = await StampAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await StampAsync(factory, "owner@example.com")).Should().NotBe(stampBefore);
            using (var scope = factory.Services.CreateScope())
            {
                var user = await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking().SingleAsync();
                user.AccessFailedCount.Should().Be(0);
                user.LockoutEnd.Should().BeNull();
            }

            (await client.PostAsJsonAsync("/account/login", new { email = "owner@example.com", password = NewPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync("/account/login", new { email = "owner@example.com", password = OldPassword })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Complete_RevokesABearerTokenIssuedBeforeTheReset()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var token = await BearerAsync(client, "owner@example.com", OldPassword);
            using (var before = await ProfileAsync(client, token))
            {
                before.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            var proof = await ProofAsync(factory, client, "owner@example.com");
            (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.NoContent);

            using var after = await ProfileAsync(client, token);
            after.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Complete_RevokesACookieSessionIssuedBeforeTheReset()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var login = await client.PostAsJsonAsync("/account/login?useCookies=true", new { email = "owner@example.com", password = OldPassword });
            var cookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];
            using (var before = new HttpRequestMessage(HttpMethod.Get, "/account/manage/info"))
            {
                before.Headers.Add("Cookie", cookie);
                (await client.SendAsync(before)).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            var proof = await ProofAsync(factory, client, "owner@example.com");
            await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            using var after = new HttpRequestMessage(HttpMethod.Get, "/account/manage/info");
            after.Headers.Add("Cookie", cookie);
            (await client.SendAsync(after)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Complete_WritesOneSecurityEvent_WithTheAccount_TheKind_TheTime_AndAHashedAddress()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            var userId = await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword }, "203.0.113.9");

            var events = await Events(factory);
            var row = events.Should().ContainSingle().Subject;
            row.UserId.Should().Be(userId);
            row.Kind.Should().Be("PasswordReset");
            row.OccurredAt.Should().Be(clock.GetUtcNow().UtcDateTime);
            row.ClientAddressHash.Should().MatchRegex("^[0-9A-F]{64}$").And.NotContain("203.0.113.9");
        }

        [Fact]
        public async Task Complete_TheSameAddressGivesTheSameHash_AndAnotherAddressAnotherHash()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");

            foreach (var address in new[] { "203.0.113.9", "203.0.113.9", "203.0.113.10" })
            {
                var proof = await ProofAsync(factory, client, "owner@example.com");
                (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword + address }, address))
                    .StatusCode.Should().Be(HttpStatusCode.NoContent);
            }

            var hashes = (await Events(factory)).OrderBy(e => e.OccurredAt).Select(e => e.ClientAddressHash).ToList();
            hashes.Should().HaveCount(3);
            hashes[0].Should().Be(hashes[1]);
            hashes[2].Should().NotBe(hashes[0]);
        }

        [Fact]
        public async Task Complete_WithNoClientAddress_StoresNullHash()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            (await Events(factory)).Should().ContainSingle().Which.ClientAddressHash.Should().BeNull();
        }

        [Fact]
        public async Task Complete_AReplayedProof_Returns401_AndChangesNothing()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");
            (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.NoContent);

            var replay = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = "an attacker chosen passphrase" });

            await AssertErrorAsync(replay, HttpStatusCode.Unauthorized, "invalid_proof");
            (await client.PostAsJsonAsync("/account/login", new { email = "owner@example.com", password = NewPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Events(factory)).Should().ContainSingle();
        }

        [Theory]
        [InlineData("wrong")]
        [InlineData("")]
        public async Task Complete_AWrongOrMissingProof_Returns401_AndNeverRunsThePasswordCheck(string proof)
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            await ProofAsync(factory, client, "owner@example.com");
            var callsBefore = factory.Breaches.Calls;

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            factory.Breaches.Calls.Should().Be(callsBefore);
            await AssertPasswordUnchangedAsync(client, "owner@example.com");
            (await Events(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Complete_AProofForAnotherAddress_Returns401()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "one@example.com");
            await CreateAccountAsync(factory, "two@example.com");
            var proof = await ProofAsync(factory, client, "one@example.com");

            var response = await Post(client, CompletePath, new { email = "two@example.com", resetProof = proof, newPassword = NewPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            await AssertPasswordUnchangedAsync(client, "two@example.com");
        }

        [Fact]
        public async Task Complete_ForAnUnknownAddress_Returns401WithTheSameBody()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();

            var response = await Post(client, CompletePath, new { email = "nobody@example.com", resetProof = "x", newPassword = NewPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
        }

        [Fact]
        public async Task Complete_AccountDeletedAfterVerify_Returns401_AndChangesNothing()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");
            using (var scope = factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var user = (await users.FindByEmailAsync("owner@example.com"))!;
                user.DeletedAt = DateTime.UtcNow;
                (await users.UpdateAsync(user)).Succeeded.Should().BeTrue();
            }

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            (await Events(factory)).Should().BeEmpty();
        }

        [Theory]
        [InlineData("short", "too_short")]
        [InlineData("fourteen chars", "too_short")]
        public async Task Complete_AShortPassword_Returns400WithTheCode_AndKeepsTheProof(string password, string code)
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = password });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("password_rejected");
            body.GetProperty("errors")[0].GetString().Should().Be(code);
            await AssertPasswordUnchangedAsync(client, "owner@example.com");
            (await Events(factory)).Should().BeEmpty();

            (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task Complete_ABreachedPassword_Returns400Breached_AndKeepsTheProof()
        {
            using var factory = NoCooldown();
            factory.Breaches.Breach("password1234567");
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = "password1234567" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0].GetString().Should().Be("breached");
            (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task Complete_WhenTheBreachCheckIsUnavailable_FailsOpen_AsSignUpDoes()
        {
            using var factory = NoCooldown();
            factory.Breaches.Unavailable = true;
            factory.Breaches.Breach(NewPassword);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");
            var callsBefore = factory.Breaches.Calls;

            var response = await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            factory.Breaches.Calls.Should().Be(callsBefore + 1);
        }

        [Fact]
        public async Task Complete_DoesNotTrimThePassword()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");
            const string password = "  spaced out  pass phrase  ";

            await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = password });

            (await client.PostAsJsonAsync("/account/login", new { email = "owner@example.com", password })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync("/account/login", new { email = "owner@example.com", password = password.Trim() })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Complete_VoidsACodeThatIsStillOpen()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            var proof = await ProofAsync(factory, client, "owner@example.com");
            await Post(client, StartPath, new { email = "owner@example.com" });
            var openCode = CodeOf(factory);

            (await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.NoContent);

            var response = await Post(client, VerifyPath, new { email = "owner@example.com", code = openCode });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Complete_VoidsALinkResetTokenIssuedBeforeIt()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");
            string token;
            using (var scope = factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                token = await users.GeneratePasswordResetTokenAsync((await users.FindByEmailAsync("owner@example.com"))!);
            }

            var proof = await ProofAsync(factory, client, "owner@example.com");
            await Post(client, CompletePath, new { email = "owner@example.com", resetProof = proof, newPassword = NewPassword });

            using var scope2 = factory.Services.CreateScope();
            var users2 = scope2.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var result = await users2.ResetPasswordAsync((await users2.FindByEmailAsync("owner@example.com"))!, token, "attacker passphrase 123");
            result.Succeeded.Should().BeFalse();
        }

        [Fact]
        public async Task TheLinkEndpoints_StayUntilTheCleanupTicket()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "owner@example.com");

            var forgot = await Post(client, "/account/forgotPassword", new { email = "owner@example.com" });

            forgot.StatusCode.Should().Be(HttpStatusCode.OK);
            factory.ResetCodes.Should().ContainSingle();
        }

        [Fact]
        public async Task Purge_DeletesExpiredProofs_AndKeepsLiveOnes()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "old@example.com");
            await CreateAccountAsync(factory, "new@example.com");
            await ProofAsync(factory, client, "old@example.com");
            clock.Advance(TimeSpan.FromMinutes(16));
            await ProofAsync(factory, client, "new@example.com");

            using var scope = factory.Services.CreateScope();
            var purged = await scope.ServiceProvider.GetRequiredService<PasswordResetService>().PurgeAsync();

            purged.Should().Be(1);
            (await Proofs(factory)).Should().ContainSingle().Which.Email.Should().Be("NEW@EXAMPLE.COM");
        }

        [Fact]
        public async Task WithNoCodeKey_StartAndVerifyAnswerServiceUnavailable_ForEveryKindOfAddress()
        {
            using var factory = new AccountRecoveryFactory(configureCodes: c => c.HmacKey = string.Empty);
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "known@example.com");

            foreach (var (path, body) in new (string, object)[]
            {
                (StartPath, new { email = "known@example.com" }),
                (StartPath, new { email = "nobody@example.com" }),
                (VerifyPath, new { email = "known@example.com", code = "123456" }),
                (VerifyPath, new { email = "nobody@example.com", code = "123456" }),
            })
            {
                (await Post(client, path, body)).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, path);
            }

            factory.AlreadyRegisteredNotices.Should().BeEmpty();
        }

        [Fact]
        public async Task NothingLogsTheEmailTheCodeTheProofOrThePassword()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();
            await CreateAccountAsync(factory, "secret.owner@example.com");
            const string password = "very secret new passphrase";

            await Post(client, StartPath, new { email = "secret.owner@example.com" });
            await Post(client, StartPath, new { email = "secret.stranger@example.com" });
            var code = CodeOf(factory);
            await Post(client, VerifyPath, new { email = "secret.owner@example.com", code = code == "000000" ? "000001" : "000000" });
            var proof = await ProofAsync(factory, client, "secret.owner@example.com");
            await Post(client, CompletePath, new { email = "secret.owner@example.com", resetProof = proof, newPassword = "short" });
            await Post(client, CompletePath, new { email = "secret.owner@example.com", resetProof = proof, newPassword = password });
            var fresh = CodeOf(factory);

            var logged = string.Join("\n", factory.Logs.Entries.Select(e => e.Message));
            logged.Should().NotContainEquivalentOf("secret.owner");
            logged.Should().NotContainEquivalentOf("secret.stranger");
            logged.Should().NotContain(proof);
            logged.Should().NotContain(password);
            System.Text.RegularExpressions.Regex.IsMatch(logged, $@"\b({code}|{fresh})\b").Should().BeFalse();
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

        private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object body, string? address = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
            if (address is not null)
            {
                request.Headers.Add("X-Real-IP", address);
            }

            return await client.SendAsync(request);
        }

        private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode status, string error)
        {
            response.StatusCode.Should().Be(status);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }

        private static List<OutboundEmail> Codes(AccountRecoveryFactory factory) =>
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).ToList();

        private static string CodeOf(AccountRecoveryFactory factory) => Codes(factory).Last().Subject.Split(' ')[0];

        private static async Task<string> ProofAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            (await Post(client, StartPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            var verify = await Post(client, VerifyPath, new { email, code = CodeOf(factory) });
            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("resetProof").GetString()!;
        }

        private static async Task<List<string>> WrongTriesAsync(HttpClient client, string email, string realCode)
        {
            var wrong = realCode == "000000" ? "000001" : "000000";
            var result = new List<string>();
            for (var i = 0; i < 5; i++)
            {
                var response = await Post(client, VerifyPath, new { email, code = wrong });
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

        private static async Task<string> BearerAsync(HttpClient client, string email, string password)
        {
            var login = await client.PostAsJsonAsync("/account/login", new { email, password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        }

        private static async Task<HttpResponseMessage> ProfileAsync(HttpClient client, string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/account/profile");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return await client.SendAsync(request);
        }

        private static async Task AssertPasswordUnchangedAsync(HttpClient client, string email)
        {
            (await client.PostAsJsonAsync("/account/login", new { email, password = OldPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
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
            (await manager.CreateAsync(user, OldPassword)).Succeeded.Should().BeTrue();
            return user.Id;
        }

        private static async Task LockOutAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = (await manager.FindByEmailAsync(email))!;
            await manager.SetLockoutEnabledAsync(user, true);
            await manager.SetLockoutEndDateAsync(user, DateTimeOffset.UtcNow.AddHours(1));
            await manager.AccessFailedAsync(user);
        }

        private static async Task<string?> StampAsync(AccountRecoveryFactory factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking()
                .SingleAsync(u => u.Email == email)).SecurityStamp;
        }

        private static async Task<int> EmailCodeCount(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().EmailCodes.CountAsync();
        }

        private static async Task<List<PasswordResetProof>> Proofs(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().PasswordResetProofs.AsNoTracking().ToListAsync();
        }

        private static async Task<List<AccountSecurityEvent>> Events(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().AccountSecurityEvents.AsNoTracking().ToListAsync();
        }
    }
}
