// <copyright file="SecureAccountEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Tests.Helpers;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the "This wasn't me" endpoint <c>POST /account/secure</c> (#662).
    /// The token comes from the real notice email, composed by the real composer.
    /// </summary>
    public class SecureAccountEndpointTests
    {
        private const string SecurePath = "/account/secure";
        private const string Password = "Old-passphrase-12345";
        private const string NewPassword = "new correct horse battery";
        private const string Old = "owner@example.com";
        private const string New = "thief@example.com";

        [Fact]
        public async Task EmailChange_Token_RestoresTheOldAddress_EndsSessions_DropsThePassword_AndWritesTheEvent()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            using var anonymous = factory.CreateClient();
            var bearer = await BearerAsync(anonymous, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            var stampBefore = (await UserAsync(factory, id)).SecurityStamp;

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailRestored").GetBoolean().Should().BeTrue();
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(Old);
            user.UserName.Should().Be(Old);
            user.EmailConfirmed.Should().BeTrue();
            user.PasswordHash.Should().BeNull();
            user.SecurityStamp.Should().NotBe(stampBefore);
            (await client.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await ProfileAsync(anonymous, bearer)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await anonymous.PostAsJsonAsync("/account/login", new { email = Old, password = Password })).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);

            var secured = (await Events(factory)).Should().ContainSingle(e => e.Kind == AccountSecurityEvent.SecureAccount).Subject;
            secured.UserId.Should().Be(id);
            JsonSerializer.Serialize(secured).Should().NotContainEquivalentOf("example.com");
            (await Restores(factory)).Should().ContainSingle().Which.ConsumedAt.Should().NotBeNull();
            (await Tokens(factory)).Should().ContainSingle().Which.ConsumedAt.Should().NotBeNull();

            await ResetByCodeAsync(factory, anonymous, Old);
            (await anonymous.PostAsJsonAsync("/account/login", new { email = Old, password = NewPassword })).StatusCode
                .Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Token_Reuse_IsRefused_AndChangesNothingMore()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            using var anonymous = factory.CreateClient();
            (await anonymous.PostAsJsonAsync(SecurePath, new { token })).StatusCode.Should().Be(HttpStatusCode.OK);
            await ResetByCodeAsync(factory, anonymous, Old);
            var stamp = (await UserAsync(factory, id)).SecurityStamp;

            var second = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("invalid_token");
            var user = await UserAsync(factory, id);
            user.SecurityStamp.Should().Be(stamp);
            user.PasswordHash.Should().NotBeNull();
            (await Events(factory)).Count(e => e.Kind == AccountSecurityEvent.SecureAccount).Should().Be(1);
        }

        [Fact]
        public async Task Token_Expired_IsRefused_AndChangesNothing()
        {
            var clock = new FakeClock();
            using var factory = NoCooldown(clock);
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            var stamp = (await UserAsync(factory, id)).SecurityStamp;
            clock.Advance(SecurityNoticeService.TokenLifetime + TimeSpan.FromMinutes(1));
            using var anonymous = factory.CreateClient();

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(New);
            user.SecurityStamp.Should().Be(stamp);
            user.PasswordHash.Should().NotBeNull();
            (await Events(factory)).Should().NotContain(e => e.Kind == AccountSecurityEvent.SecureAccount);
            (await Tokens(factory)).Single().ConsumedAt.Should().BeNull();
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not-a-token")]
        public async Task Token_MissingOrUnknown_IsRefused(string? token)
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var anonymous = factory.CreateClient();

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Events(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task Restore_WhenAnotherAccountNowHoldsTheOldAddress_SecuresTheAccountButKeepsTheEmail()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            await CreateAccountAsync(factory, Old);
            using var anonymous = factory.CreateClient();

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailRestored").GetBoolean().Should().BeFalse();
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(New);
            user.PasswordHash.Should().BeNull();
            (await client.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await Restores(factory)).Should().ContainSingle().Which.ConsumedAt.Should().BeNull();
            (await Events(factory)).Should().ContainSingle(e => e.Kind == AccountSecurityEvent.SecureAccount);
        }

        [Fact]
        public async Task Restore_AfterTheWindow_SecuresTheAccountButKeepsTheEmail()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            await EndRestoreWindowAsync(factory);
            using var anonymous = factory.CreateClient();

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailRestored").GetBoolean().Should().BeFalse();
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(New);
            user.PasswordHash.Should().BeNull();
            (await Restores(factory)).Should().ContainSingle().Which.ConsumedAt.Should().BeNull();
        }

        [Fact]
        public async Task PasswordResetToken_SecuresTheAccount_WithoutTouchingTheEmail()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var anonymous = factory.CreateClient();
            await ResetByCodeAsync(factory, anonymous, Old);
            var token = TokenFor(factory, AccountSecurityEvent.PasswordReset);

            var response = await anonymous.PostAsJsonAsync(SecurePath, new { token });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("emailRestored").GetBoolean().Should().BeFalse();
            var user = await UserAsync(factory, id);
            user.Email.Should().Be(Old);
            user.PasswordHash.Should().BeNull();
        }

        [Fact]
        public async Task Get_DoesNotActOnTheToken()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, factory);
            var token = TokenFor(factory, AccountSecurityEvent.EmailChanged);
            using var anonymous = factory.CreateClient();

            var response = await anonymous.GetAsync($"{SecurePath}?token={token}");

            response.IsSuccessStatusCode.Should().BeFalse();
            (await UserAsync(factory, id)).PasswordHash.Should().NotBeNull();
            (await Tokens(factory)).Single().ConsumedAt.Should().BeNull();
        }

        [Fact]
        public async Task Secure_LogsNeitherTheTokenNorAnAddress()
        {
            using var logs = new CapturingLoggerProvider();
            using var recording = NoCooldown();
            using var factory = recording.WithWebHostBuilder(builder => builder.ConfigureLogging(logging => logging.AddProvider(logs)));
            await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            await ChangeEmailAsync(client, recording);
            var token = TokenFor(recording, AccountSecurityEvent.EmailChanged);
            using var anonymous = factory.CreateClient();
            var before = logs.Entries.Count;

            (await anonymous.PostAsJsonAsync(SecurePath, new { token })).StatusCode.Should().Be(HttpStatusCode.OK);

            var logged = string.Join('\n', logs.Entries.Skip(before).Select(e => e.Message));
            logged.Should().NotContain(token);
            logged.Should().NotContainEquivalentOf("example.com");
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

        private static string TokenFor(AccountRecoveryFactory factory, string kind)
        {
            var subject = kind == AccountSecurityEvent.EmailChanged ? EmailKind.EmailChangedNotice : EmailKind.PasswordChangedNotice;
            var notice = factory.AlreadyRegisteredNotices.Last(m => m.Kind == subject);
            var line = notice.TextBody.Split('\n').Single(l => l.Contains("/secure-account?token=", StringComparison.Ordinal));
            return new Uri(line.Trim()).Query["?token=".Length..];
        }

        private static string CodeFor(AccountRecoveryFactory factory, string to) =>
            factory.AlreadyRegisteredNotices
                .Last(m => m.Kind == EmailKind.Code && string.Equals(m.To, to, StringComparison.OrdinalIgnoreCase))
                .Subject.Split(' ')[0];

        private static async Task ChangeEmailAsync(HttpClient client, AccountRecoveryFactory factory)
        {
            (await client.PostAsJsonAsync("/account/email/change/start", new { newEmail = New, currentPassword = Password }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync("/account/email/change/verify", new { code = CodeFor(factory, New) }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static async Task ResetByCodeAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            (await client.PostAsJsonAsync("/account/password/reset/start", new { email })).StatusCode.Should().Be(HttpStatusCode.OK);
            var verify = await client.PostAsJsonAsync("/account/password/reset/verify", new { email, code = CodeFor(factory, email) });
            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            var proof = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("resetProof").GetString();
            (await client.PostAsJsonAsync("/account/password/reset/complete", new { email, resetProof = proof, newPassword = NewPassword }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        private static async Task EndRestoreWindowAsync(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            foreach (var restore in await db.EmailChangeRestores.ToListAsync())
            {
                restore.RestoreUntil = restore.ChangedAt.AddSeconds(-1);
            }

            await db.SaveChangesAsync();
        }

        private static async Task<string> BearerAsync(HttpClient client, string email)
        {
            var login = await client.PostAsJsonAsync("/account/login", new { email, password = Password });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            return (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        }

        private static async Task<HttpResponseMessage> ProfileAsync(HttpClient client, string token)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/account/profile");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            return await client.SendAsync(request);
        }

        private static async Task<HttpClient> SignInAsync(WebApplicationFactory<TestEntryPoint> factory, string email)
        {
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                HandleCookies = true,
                AllowAutoRedirect = false,
            });
            (await client.PostAsJsonAsync("/account/login?useCookies=true", new { email, password = Password })).EnsureSuccessStatusCode();
            return client;
        }

        private static async Task<string> CreateAccountAsync(WebApplicationFactory<TestEntryPoint> factory, string email)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true };
            (await manager.CreateAsync(user, Password)).Succeeded.Should().BeTrue();
            return user.Id;
        }

        private static async Task<ApplicationUser> UserAsync(AccountRecoveryFactory factory, string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking().SingleAsync(u => u.Id == id);
        }

        private static async Task<List<SecureAccountToken>> Tokens(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().SecureAccountTokens.AsNoTracking().ToListAsync();
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
