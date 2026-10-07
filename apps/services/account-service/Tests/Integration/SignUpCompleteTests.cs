// <copyright file="SignUpCompleteTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Configuration;
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
    /// Integration tests for <c>POST /account/signup/complete</c> and the password policy (#654).
    /// </summary>
    public class SignUpCompleteTests
    {
        private const string StartPath = "/account/signup/start";
        private const string VerifyPath = "/account/signup/verify";
        private const string CompletePath = "/account/signup/complete";
        private const string GoodPassword = "correct horse battery";

        [Fact]
        public async Task Complete_CreatesAConfirmedAccount_DeletesThePendingRow_AndReturnsABearerSession()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "New.Person@Example.com";
            var proof = await ProofAsync(factory, client, email);

            using var request = CompleteRequest(email, proof, GoodPassword);
            request.Headers.Add("X-App-Id", "cribstop");
            var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var token = body.GetProperty("accessToken").GetString();
            token.Should().NotBeNullOrWhiteSpace();

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var user = await db.Users.AsNoTracking().SingleAsync();
            user.Email.Should().Be(email);
            user.UserName.Should().Be(email);
            user.EmailConfirmed.Should().BeTrue();
            user.SecurityStamp.Should().NotBeNullOrWhiteSpace();
            user.PasswordHash.Should().NotBeNullOrWhiteSpace().And.NotContain(GoodPassword);
            (await db.PendingRegistrations.AsNoTracking().ToListAsync()).Should().BeEmpty();
            (await db.UserApps.AsNoTracking().Where(a => a.UserId == user.Id).Select(a => a.AppId).ToListAsync())
                .Should().Equal("cribstop");
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            (await manager.GetRolesAsync((await manager.FindByIdAsync(user.Id))!)).Should().Equal(Roles.User);

            using var info = new HttpRequestMessage(HttpMethod.Get, "/account/manage/info");
            info.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var infoResponse = await client.SendAsync(info);
            infoResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            (await infoResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isEmailConfirmed").GetBoolean().Should().BeTrue();
        }

        [Fact]
        public async Task Complete_WithUseCookies_SetsTheSessionCookie_AndTheCookieWorks()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "cookie@example.com";
            var proof = await ProofAsync(factory, client, email);

            using var request = CompleteRequest(email, proof, GoodPassword, "?useCookies=true");
            var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var cookie = response.Headers.GetValues("Set-Cookie").Should().ContainSingle().Subject.Split(';')[0];

            using var info = new HttpRequestMessage(HttpMethod.Get, "/account/manage/info");
            info.Headers.Add("Cookie", cookie);
            (await client.SendAsync(info)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_TheAccountCanLogInAgainWithThePassword()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "again@example.com";
            await CompleteAsync(factory, client, email, GoodPassword);

            var login = await client.PostAsJsonAsync("/account/login", new { email, password = GoodPassword });

            login.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_WithAWrongProof_Returns401_AndCreatesNothing()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "wrong@example.com";
            await ProofAsync(factory, client, email);

            var response = await Post(client, new { email, signupProof = "not-the-proof", password = GoodPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            (await UserCount(factory)).Should().Be(0);
            (await PendingCount(factory)).Should().Be(1);
        }

        [Fact]
        public async Task Complete_WithNoProof_Returns401_AndNeverRunsThePasswordCheck()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, new { email = "none@example.com", password = GoodPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            factory.Breaches.Calls.Should().Be(0);
        }

        [Fact]
        public async Task Complete_AProofForAnotherAddress_Returns401()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            var proof = await ProofAsync(factory, client, "one@example.com");
            await ProofAsync(factory, client, "two@example.com");

            var response = await Post(client, new { email = "two@example.com", signupProof = proof, password = GoodPassword });

            await AssertErrorAsync(response, HttpStatusCode.Unauthorized, "invalid_proof");
            (await UserCount(factory)).Should().Be(0);
        }

        [Fact]
        public async Task Complete_AReplayedProof_Returns401_AndMakesNoSecondAccount()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "replay@example.com";
            var proof = await ProofAsync(factory, client, email);
            (await Post(client, new { email, signupProof = proof, password = GoodPassword })).StatusCode.Should().Be(HttpStatusCode.OK);

            var replay = await Post(client, new { email, signupProof = proof, password = "another long passphrase" });

            await AssertErrorAsync(replay, HttpStatusCode.Unauthorized, "invalid_proof");
            (await UserCount(factory)).Should().Be(1);
        }

        [Fact]
        public async Task Complete_WhenAnAccountAppearedSinceStart_ReturnsNeutralFailure_AndCreatesNothing()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "race@example.com";
            var proof = await ProofAsync(factory, client, email);
            await CreateAccountAsync(factory, email.ToUpperInvariant(), deleted: false);

            var response = await Post(client, new { email, signupProof = proof, password = GoodPassword });

            await AssertErrorAsync(response, HttpStatusCode.Conflict, "email_unavailable");
            (await UserCount(factory)).Should().Be(1);
            (await PendingCount(factory)).Should().Be(0);
        }

        [Fact]
        public async Task Complete_ForASoftDeletedEmail_ReturnsTheSameNeutralFailure()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "gone@example.com";
            var proof = await ProofAsync(factory, client, email);
            await CreateAccountAsync(factory, email, deleted: true);

            var response = await Post(client, new { email, signupProof = proof, password = GoodPassword });

            await AssertErrorAsync(response, HttpStatusCode.Conflict, "email_unavailable");
            (await UserCount(factory)).Should().Be(1);
        }

        [Theory]
        [InlineData("short", "too_short")]
        [InlineData("fourteen chars", "too_short")]
        public async Task Complete_AShortPassword_Returns400WithTheCode_AndKeepsTheProof(string password, string code)
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "short@example.com";
            var proof = await ProofAsync(factory, client, email);

            var response = await Post(client, new { email, signupProof = proof, password });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("password_rejected");
            body.GetProperty("errors").EnumerateArray().Select(e => e.GetString()).Should().Equal(code);
            (await UserCount(factory)).Should().Be(0);

            // The user fixes the password with the same proof.
            (await Post(client, new { email, signupProof = proof, password = GoodPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_AFifteenCharacterPasswordWithNoComposition_Passes()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            await CompleteAsync(factory, client, "plain@example.com", "aaaaaaaaaaaaaaa");

            (await UserCount(factory)).Should().Be(1);
        }

        [Fact]
        public async Task Complete_APasswordOver128_Returns400TooLong_And128Passes()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "long@example.com";
            var proof = await ProofAsync(factory, client, email);

            var tooLong = await Post(client, new { email, signupProof = proof, password = new string('a', 129) });

            tooLong.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await tooLong.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0].GetString().Should().Be("too_long");
            (await Post(client, new { email, signupProof = proof, password = new string('a', 128) })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_DoesNotTrimThePassword_AndAllowsSpaces()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "spaces@example.com";
            const string password = "  spaced out  pass phrase  ";
            await CompleteAsync(factory, client, email, password);

            (await client.PostAsJsonAsync("/account/login", new { email, password })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync("/account/login", new { email, password = password.Trim() })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Complete_ABreachedPassword_Returns400Breached_AndKeepsTheProof()
        {
            using var factory = new AccountRecoveryFactory();
            factory.Breaches.Breach("password1234567");
            using var client = factory.CreateClient();
            const string email = "breach@example.com";
            var proof = await ProofAsync(factory, client, email);

            var response = await Post(client, new { email, signupProof = proof, password = "password1234567" });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0].GetString().Should().Be("breached");
            (await UserCount(factory)).Should().Be(0);
            (await Post(client, new { email, signupProof = proof, password = GoodPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_WhenTheBreachCheckIsUnavailable_FailsOpen()
        {
            using var factory = new AccountRecoveryFactory();
            factory.Breaches.Unavailable = true;
            factory.Breaches.Breach("password1234567");
            using var client = factory.CreateClient();

            await CompleteAsync(factory, client, "open@example.com", "password1234567");

            (await UserCount(factory)).Should().Be(1);
            factory.Breaches.Calls.Should().Be(1);
        }

        [Fact]
        public async Task Complete_TheMinimumLengthComesFromConfiguration()
        {
            using var factory = new AccountRecoveryFactory();
            using var configured = factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
                s.PostConfigure<PasswordPolicyOptions>(o => o.MinLength = 10)));
            using var client = configured.CreateClient();
            const string email = "config@example.com";
            var proof = await ProofAsync(factory, client, email);

            (await Post(client, new { email, signupProof = proof, password = "ten chars!" })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Complete_NeverLogsTheAddressThePasswordOrTheProof()
        {
            using var factory = new AccountRecoveryFactory();
            factory.Breaches.Breach("password1234567");
            using var client = factory.CreateClient();
            const string email = "secret.logger@example.com";
            var proof = await ProofAsync(factory, client, email);
            await Post(client, new { email, signupProof = proof, password = "password1234567" });
            await Post(client, new { email, signupProof = proof, password = GoodPassword });
            await Post(client, new { email, signupProof = proof, password = GoodPassword });

            var logged = string.Join("\n", factory.Logs.Entries.Select(e => e.Message));
            logged.Should().NotContainEquivalentOf("secret.logger");
            logged.Should().NotContain(proof);
            logged.Should().NotContain("password1234567").And.NotContain(GoodPassword);
        }

        [Fact]
        public async Task Policy_AppliesToTheInAccountChange()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "change@example.com";
            var token = await CompleteAsync(factory, client, email, GoodPassword);

            using var change = new HttpRequestMessage(HttpMethod.Post, "/account/manage/info")
            {
                Content = JsonContent.Create(new { oldPassword = GoodPassword, newPassword = "short" }),
            };
            change.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await client.SendAsync(change);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync()).Should().Contain("too_short");
        }

        [Fact]
        public async Task Policy_AnExistingShorterPasswordStillLogsIn()
        {
            using var factory = new AccountRecoveryFactory();
            using var client = factory.CreateClient();
            const string email = "legacy@example.com";
            using (var scope = factory.Services.CreateScope())
            {
                var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var user = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true };
                user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, "Old1!aaa");
                (await manager.CreateAsync(user)).Succeeded.Should().BeTrue();
            }

            (await client.PostAsJsonAsync("/account/login", new { email, password = "Old1!aaa" })).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static HttpRequestMessage CompleteRequest(string email, string proof, string password, string query = "") =>
            new(HttpMethod.Post, CompletePath + query)
            {
                Content = JsonContent.Create(new { email, signupProof = proof, password }),
            };

        private static Task<HttpResponseMessage> Post(HttpClient client, object body) =>
            client.PostAsJsonAsync(CompletePath, body);

        private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode status, string error)
        {
            response.StatusCode.Should().Be(status);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }

        private static async Task<string> ProofAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            (await client.PostAsJsonAsync(StartPath, new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            var code = factory.AlreadyRegisteredNotices.Last(m => m.Kind == EmailKind.Code).Subject.Split(' ')[0];
            var verify = await client.PostAsJsonAsync(VerifyPath, new { email, code });
            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("signupProof").GetString()!;
        }

        private static async Task<string?> CompleteAsync(AccountRecoveryFactory factory, HttpClient client, string email, string password)
        {
            var proof = await ProofAsync(factory, client, email);
            var response = await Post(client, new { email, signupProof = proof, password });
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        }

        private static async Task<int> UserCount(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.CountAsync();
        }

        private static async Task<int> PendingCount(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().PendingRegistrations.CountAsync();
        }

        private static async Task CreateAccountAsync(AccountRecoveryFactory factory, string email, bool deleted)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser
            {
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                DeletedAt = deleted ? DateTime.UtcNow : null,
            };
            (await manager.CreateAsync(user, GoodPassword)).Succeeded.Should().BeTrue();
        }
    }
}
