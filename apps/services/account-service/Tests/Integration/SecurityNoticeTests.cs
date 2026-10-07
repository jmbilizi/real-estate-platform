// <copyright file="SecurityNoticeTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
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
    /// Integration tests for the security notices and the password-change hardening (#661).
    /// A fake sender records every message, composed by the real composer.
    /// </summary>
    public class SecurityNoticeTests
    {
        private const string InfoPath = "/account/manage/info";
        private const string Password = "Old-passphrase-12345";
        private const string NewPassword = "new correct horse battery";
        private const string Old = "owner@example.com";
        private const string New = "fresh@example.com";

        [Theory]
        [InlineData("jane@gmail.com", "j***@gmail.com")]
        [InlineData("j@gmail.com", "***@gmail.com")]
        [InlineData("jane.doe@sub.example.com", "j***@sub.example.com")]
        [InlineData("nonsense", "***")]
        public void MaskEmail_KeepsTheFirstLetterAndTheDomain(string address, string expected) =>
            SecurityNoticeService.MaskEmail(address).Should().Be(expected);

        [Fact]
        public async Task EmailChange_NotifiesTheOldAddressOnly_WithAMaskedNewAddress_AndASingleUseLink()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);

            await ChangeEmailAsync(client, factory);

            var notice = factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.EmailChangedNotice).Subject;
            notice.To.Should().Be(Old);
            notice.Subject.Should().Be("Your Cribstop email address changed");
            notice.TextBody.Should().Contain("f***@example.com");
            notice.TextBody.Should().NotContainEquivalentOf(New);
            notice.TextBody.Should().NotContain(Password);
            notice.TextBody.Should().MatchRegex(@"When: [A-Z][a-z]+ \d{1,2}, \d{4} at \d{2}:\d{2} UTC\.");
            notice.TextBody.Should().Contain("expires in 7 days");
            notice.TextBody.Should().Contain("reply to this message at contact@cribstop.com");
            notice.TextBody.Should().Contain("Real Broker");
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.EmailChangedNotice && m.To == New).Should().BeEmpty();

            var token = TokenFrom(notice);
            var row = (await Tokens(factory)).Should().ContainSingle().Subject;
            row.UserId.Should().Be(id);
            row.Kind.Should().Be(AccountSecurityEvent.EmailChanged);
            row.ConsumedAt.Should().BeNull();
            row.TokenHash.Should().Equal(SecurityNoticeService.HashToken(token));
            (row.ExpiresAt - row.CreatedAt).Should().Be(TimeSpan.FromDays(7));
        }

        [Fact]
        public async Task EmailChange_ToASuppressedOldAddress_SendsNoNotice_AndStillChanges()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            await SuppressAsync(factory, "OWNER@EXAMPLE.COM");
            using var client = await SignInAsync(factory, Old);

            await ChangeEmailAsync(client, factory);

            factory.AlreadyRegisteredNotices.Should().NotContain(m => m.Kind == EmailKind.EmailChangedNotice);
            (await Tokens(factory)).Should().BeEmpty();
            (await UserAsync(factory, id)).Email.Should().Be(New);
        }

        [Fact]
        public async Task PasswordReset_NotifiesTheAccountAddress_WithoutThePassword()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = factory.CreateClient();

            await ResetPasswordAsync(factory, client);

            var notice = factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.PasswordChangedNotice).Subject;
            notice.To.Should().Be(Old);
            notice.Subject.Should().Be("Your Cribstop password was reset");
            notice.TextBody.Should().Contain("secure-account?token=");
            notice.TextBody.Should().NotContain(NewPassword);
            notice.TextBody.Should().NotContain(Password);
            var row = (await Tokens(factory)).Should().ContainSingle().Subject;
            row.UserId.Should().Be(id);
            row.Kind.Should().Be(AccountSecurityEvent.PasswordReset);
        }

        [Fact]
        public async Task PasswordChange_Succeeds_RotatesTheStamp_RevokesOtherSessions_AndKeepsThisOne()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var current = await SignInAsync(factory, Old);
            using var other = await SignInAsync(factory, Old);
            using var anonymous = factory.CreateClient();
            var otherBearer = await BearerAsync(anonymous, Old);
            var stampBefore = (await UserAsync(factory, id)).SecurityStamp;

            var response = await current.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("email").GetString().Should().Be(Old);
            (await UserAsync(factory, id)).SecurityStamp.Should().NotBe(stampBefore);
            (await current.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.OK);
            (await other.GetAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await ProfileAsync(anonymous, otherBearer)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await anonymous.PostAsJsonAsync("/account/login", new { email = Old, password = NewPassword })).StatusCode.Should().Be(HttpStatusCode.OK);
            (await anonymous.PostAsJsonAsync("/account/login", new { email = Old, password = Password })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var changed = (await Events(factory)).Should().ContainSingle().Subject;
            changed.Kind.Should().Be(AccountSecurityEvent.PasswordChanged);
            changed.UserId.Should().Be(id);
            JsonSerializer.Serialize(changed).Should().NotContainEquivalentOf("example.com");

            var notice = factory.AlreadyRegisteredNotices.Should().ContainSingle(m => m.Kind == EmailKind.PasswordChangedNotice).Subject;
            notice.To.Should().Be(Old);
            notice.Subject.Should().Be("Your Cribstop password changed");
            notice.TextBody.Should().NotContain(NewPassword);
            notice.TextBody.Should().NotContain(Password);
            (await Tokens(factory)).Should().ContainSingle().Which.Kind.Should().Be(AccountSecurityEvent.PasswordChanged);
        }

        [Fact]
        public async Task PasswordChange_ForABearerSession_ReturnsANewToken_AndRevokesTheOldOne()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var client = factory.CreateClient();
            var old = await BearerAsync(client, Old);

            using var request = new HttpRequestMessage(HttpMethod.Post, InfoPath)
            {
                Content = JsonContent.Create(new { oldPassword = Password, newPassword = NewPassword }),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", old);
            var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var fresh = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
            (await ProfileAsync(client, fresh)).StatusCode.Should().Be(HttpStatusCode.OK);
            (await ProfileAsync(client, old)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PasswordChange_WithoutTheCurrentPassword_Returns400_AndChangesNothing()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            var stampBefore = (await UserAsync(factory, id)).SecurityStamp;

            var response = await client.PostAsJsonAsync(InfoPath, new { newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("OldPasswordRequired", out _).Should().BeTrue();
            await AssertUnchangedAsync(factory, id, stampBefore);
        }

        [Fact]
        public async Task PasswordChange_WithAWrongCurrentPassword_Returns400_CountsTowardTheLock_AndSendsNothing()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            var stampBefore = (await UserAsync(factory, id)).SecurityStamp;

            var response = await client.PostAsJsonAsync(InfoPath, new { oldPassword = "not-the-password-1", newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("PasswordMismatch", out _).Should().BeTrue();
            (await UserAsync(factory, id)).AccessFailedCount.Should().Be(1);
            await AssertUnchangedAsync(factory, id, stampBefore);

            for (var i = 0; i < 6; i++)
            {
                await client.PostAsJsonAsync(InfoPath, new { oldPassword = "not-the-password-1", newPassword = NewPassword });
            }

            var locked = await client.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = NewPassword });
            locked.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            locked.Headers.Contains("Retry-After").Should().BeTrue();
            await AssertUnchangedAsync(factory, id, stampBefore);
        }

        [Theory]
        [InlineData("short1")]
        [InlineData("password1234567")]
        public async Task PasswordChange_ToAWeakOrBreachedPassword_Returns400_AndChangesNothing(string weak)
        {
            using var factory = NoCooldown();
            factory.Breaches.Breach("password1234567");
            var id = await CreateAccountAsync(factory, Old);
            using var client = await SignInAsync(factory, Old);
            var stampBefore = (await UserAsync(factory, id)).SecurityStamp;

            var response = await client.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = weak });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").EnumerateObject().Should().NotBeEmpty();
            await AssertUnchangedAsync(factory, id, stampBefore);
        }

        [Fact]
        public async Task PasswordChange_WithoutASession_Returns401()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Old);
            using var anonymous = factory.CreateClient();

            (await anonymous.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = NewPassword }))
                .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PasswordChange_ToASuppressedAddress_SendsNoNotice_AndStillChanges()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Old);
            await SuppressAsync(factory, "OWNER@EXAMPLE.COM");
            using var client = await SignInAsync(factory, Old);

            (await client.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = NewPassword })).StatusCode.Should().Be(HttpStatusCode.OK);

            factory.AlreadyRegisteredNotices.Should().NotContain(m => m.Kind == EmailKind.PasswordChangedNotice);
            (await Events(factory)).Should().ContainSingle();
            (await UserAsync(factory, id)).Should().NotBeNull();
        }

        [Fact]
        public async Task ASendFailure_NeverBlocksThePasswordChange_AndLogsTheKindOnly()
        {
            using var recording = new AccountRecoveryFactory();
            using var logs = new CapturingLoggerProvider();
            using var factory = recording.WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services => services.AddSingleton<IOutboundEmailSender>(new ThrowingSender()));
                builder.ConfigureLogging(logging => logging.AddProvider(logs));
            });
            await CreateAccountAsync(factory, Old);
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true, AllowAutoRedirect = false });
            (await client.PostAsJsonAsync("/account/login?useCookies=true", new { email = Old, password = Password })).EnsureSuccessStatusCode();

            var response = await client.PostAsJsonAsync(InfoPath, new { oldPassword = Password, newPassword = NewPassword });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var logged = string.Join('\n', logs.Entries.Select(e => e.Message));
            logged.Should().Contain("PasswordChangedNotice").And.Contain("failed");
            logged.Should().NotContainEquivalentOf("owner@example");
            logged.Should().NotContain(NewPassword);
            logged.Should().NotContain("secure-account");
        }

        private static AccountRecoveryFactory NoCooldown() =>
            new(configureCodes: c =>
            {
                c.ResendCooldown = TimeSpan.Zero;
                c.MaxPerHour = 100;
                c.MaxPerDay = 100;
            });

        private static string TokenFrom(OutboundEmail notice)
        {
            var line = notice.TextBody.Split('\n').Single(l => l.Contains("/secure-account?token=", StringComparison.Ordinal));
            return new Uri(line.Trim()).Query["?token=".Length..];
        }

        private static List<OutboundEmail> Codes(AccountRecoveryFactory factory) =>
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).ToList();

        private static string CodeFor(AccountRecoveryFactory factory, string to) =>
            Codes(factory).Last(m => string.Equals(m.To, to, StringComparison.OrdinalIgnoreCase)).Subject.Split(' ')[0];

        private static async Task ChangeEmailAsync(HttpClient client, AccountRecoveryFactory factory)
        {
            (await client.PostAsJsonAsync("/account/email/change/start", new { newEmail = New, currentPassword = Password }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync("/account/email/change/verify", new { code = CodeFor(factory, New) }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static async Task ResetPasswordAsync(AccountRecoveryFactory factory, HttpClient client)
        {
            (await client.PostAsJsonAsync("/account/password/reset/start", new { email = Old })).StatusCode.Should().Be(HttpStatusCode.OK);
            var verify = await client.PostAsJsonAsync("/account/password/reset/verify", new { email = Old, code = CodeFor(factory, Old) });
            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            var proof = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("resetProof").GetString();
            (await client.PostAsJsonAsync("/account/password/reset/complete", new { email = Old, resetProof = proof, newPassword = NewPassword }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        private static async Task AssertUnchangedAsync(AccountRecoveryFactory factory, string id, string? stampBefore)
        {
            (await UserAsync(factory, id)).SecurityStamp.Should().Be(stampBefore);
            (await Events(factory)).Should().BeEmpty();
            (await Tokens(factory)).Should().BeEmpty();
            factory.AlreadyRegisteredNotices.Should().NotContain(m => m.Kind == EmailKind.PasswordChangedNotice);
        }

        private static async Task SuppressAsync(AccountRecoveryFactory factory, string key)
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<EmailSuppressionService>().SuppressAsync(key, "HardBounce", "test");
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

        private static async Task<List<AccountSecurityEvent>> Events(AccountRecoveryFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().AccountSecurityEvents.AsNoTracking().ToListAsync();
        }

        private sealed class ThrowingSender : IOutboundEmailSender
        {
            public Task SendAsync(OutboundEmail message, CancellationToken cancellationToken = default) =>
                throw new InvalidOperationException("The transport failed for owner@example.com.");
        }
    }
}
