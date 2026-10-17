// <copyright file="DeviceSignInEndpointTests.cs" company="PlaceholderCompany">
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
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>Integration tests for the email code on a new device (#818).</summary>
    public class DeviceSignInEndpointTests
    {
        private const string Password = "Old-passphrase-12345";
        private const string Email = "owner@example.com";
        private const string SettingPath = "/account/security/new-device";

        [Fact]
        public async Task TheSetting_IsOffByDefault_AndSignInNeedsNoCode()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email);
            using var client = factory.CreateClient();

            var login = await LoginAsync(client, Email, Password);
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            var token = await AccessTokenAsync(login);

            var state = await GetAsync(client, SettingPath, token);
            (await state.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("enabled").GetBoolean().Should().BeFalse();
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task TurningItOn_NeedsTheCurrentPassword_AndTrustsTheCurrentDevice()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Email);
            using var client = factory.CreateClient();
            var token = await AccessTokenAsync(await LoginAsync(client, Email, Password));

            var wrong = await PutAsync(client, new { enabled = true, currentPassword = "Wrong-passphrase-1234" }, token);
            wrong.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await UserAsync(factory, id)).RequireDeviceCode.Should().BeFalse();

            var missing = await PutAsync(client, new { enabled = true }, token, label: "Chrome on Windows");
            missing.StatusCode.Should().Be(HttpStatusCode.Forbidden);

            var ok = await PutAsync(client, new { enabled = true, currentPassword = Password }, token, label: "Chrome on Windows");
            ok.StatusCode.Should().Be(HttpStatusCode.OK);
            (await UserAsync(factory, id)).RequireDeviceCode.Should().BeTrue();
            var device = ok.Headers.GetValues(DeviceTrustService.IssuedTokenHeader).Single();
            ok.Headers.GetValues(DeviceTrustService.IssuedMaxAgeHeader).Single().Should().Be((30 * 24 * 3600).ToString(System.Globalization.CultureInfo.InvariantCulture));

            var list = await (await GetAsync(client, SettingPath, token, device)).Content.ReadFromJsonAsync<JsonElement>();
            list.GetProperty("enabled").GetBoolean().Should().BeTrue();
            var row = list.GetProperty("devices").EnumerateArray().Should().ContainSingle().Subject;
            row.GetProperty("label").GetString().Should().Be("Chrome on Windows");
            row.GetProperty("current").GetBoolean().Should().BeTrue();
            row.GetProperty("firstSeenAt").GetDateTime().Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(1));
        }

        [Fact]
        public async Task SignIn_FromAnUnrecognizedDevice_SendsACode_AndIssuesNoSession()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();

            var login = await LoginAsync(client, Email, Password);

            login.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            var body = await login.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("device_code_required");
            body.GetProperty("expiresInSeconds").GetInt32().Should().Be(600);
            body.TryGetProperty("accessToken", out _).Should().BeFalse();
            Codes(factory).Should().ContainSingle().Which.To.Should().Be(Email);
        }

        [Fact]
        public async Task SignIn_WithAWrongPassword_SendsNoCode_AndAnswersLikeAnyFailure()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();

            var login = await LoginAsync(client, Email, "Wrong-passphrase-1234");

            login.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await login.Content.ReadAsStringAsync()).Should().NotContain("device_code_required");
            Codes(factory).Should().BeEmpty();
        }

        [Fact]
        public async Task VerifyingTheCode_SignsIn_IssuesADeviceToken_AndThatDeviceSkipsTheCodeNextTime()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            (await LoginAsync(client, Email, Password)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var verify = await client.PostAsJsonAsync("/account/login/device", new { email = Email, password = Password, code = CodeFor(factory) });

            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            (await AccessTokenAsync(verify)).Should().NotBeNullOrEmpty();
            var device = verify.Headers.GetValues(DeviceTrustService.IssuedTokenHeader).Single();
            (await Devices(factory, id)).Should().ContainSingle().Which.TokenHash.Should().NotBeEquivalentTo(System.Text.Encoding.UTF8.GetBytes(device));

            var again = await LoginAsync(client, Email, Password, device);
            again.StatusCode.Should().Be(HttpStatusCode.OK);
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task VerifyingTheCode_WithAWrongCode_Counts_AndWithAWrongPassword_SendsNothingBack()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            (await LoginAsync(client, Email, Password)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var wrongCode = await client.PostAsJsonAsync("/account/login/device", new { email = Email, password = Password, code = "000000" });
            wrongCode.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await wrongCode.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attemptsLeft").GetInt32().Should().Be(4);
            wrongCode.Headers.Contains(DeviceTrustService.IssuedTokenHeader).Should().BeFalse();

            var wrongPassword = await client.PostAsJsonAsync("/account/login/device", new { email = Email, password = "Wrong-passphrase-1234", code = CodeFor(factory) });
            wrongPassword.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var unknown = await client.PostAsJsonAsync("/account/login/device", new { email = "nobody@example.com", password = Password, code = "123456" });
            unknown.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task ACodeFromAnotherPurpose_DoesNotApproveADevice()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email, requireCode: false);
            using var client = factory.CreateClient();

            var verify = await client.PostAsJsonAsync("/account/login/device", new { email = Email, password = Password, code = "123456" });

            verify.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Resend_NeedsThePassword_AndSendsANewCode()
        {
            using var factory = NoCooldown();
            await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            (await LoginAsync(client, Email, Password)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            (await client.PostAsJsonAsync("/account/login/device/resend", new { email = Email, password = "Wrong-passphrase-1234" }))
                .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            Codes(factory).Should().ContainSingle();

            var resend = await client.PostAsJsonAsync("/account/login/device/resend", new { email = Email, password = Password });

            resend.StatusCode.Should().Be(HttpStatusCode.OK);
            Codes(factory).Should().HaveCount(2);
        }

        [Fact]
        public async Task TheCooldown_ShowsAsAReason_NotAnError()
        {
            using var factory = new AccountRecoveryFactory();
            await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            (await LoginAsync(client, Email, Password)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var second = await LoginAsync(client, Email, Password);

            second.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            var body = await second.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("error").GetString().Should().Be("device_code_required");
            body.GetProperty("reason").GetString().Should().Be("cooldown");
            body.GetProperty("resendAfterSeconds").GetInt32().Should().BeGreaterThan(0);
            Codes(factory).Should().ContainSingle();
        }

        [Fact]
        public async Task ATamperedToken_AnotherAccountsToken_AndARemovedDevice_AreAllChallenged()
        {
            using var factory = NoCooldown();
            var ownerId = await CreateAccountAsync(factory, Email, requireCode: true);
            await CreateAccountAsync(factory, "other@example.com", requireCode: true);
            using var client = factory.CreateClient();
            var otherSession = await AccessTokenAsync(await LoginAsync(client, "other@example.com", Password, await ApproveAsync(factory, client, "other@example.com")));
            otherSession.Should().NotBeNullOrEmpty();
            var ownerDevice = await ApproveAsync(factory, client, Email);

            // The owner's own token works.
            (await LoginAsync(client, Email, Password, ownerDevice)).StatusCode.Should().Be(HttpStatusCode.OK);

            // A flipped signature fails before the database.
            var tampered = ownerDevice[..^2] + (ownerDevice[^2] == 'A' ? "B" : "A") + ownerDevice[^1];
            (await LoginAsync(client, Email, Password, tampered)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            // Another account's valid token does not trust this account's sign-in.
            var otherDevice = await ApproveAsync(factory, client, "other@example.com");
            (await LoginAsync(client, Email, Password, otherDevice)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            // The owner signs the device out. The same token is challenged again.
            var ownerSession = await AccessTokenAsync(await LoginAsync(client, Email, Password, ownerDevice));
            var rows = await Devices(factory, ownerId);
            var target = rows.OrderBy(d => d.FirstSeenAt).First();
            using var delete = new HttpRequestMessage(HttpMethod.Delete, $"{SettingPath}/devices/{target.Id}");
            delete.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ownerSession);
            (await client.SendAsync(delete)).StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await LoginAsync(client, Email, Password, ownerDevice)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task AnExpiredDevice_IsChallenged()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            var device = await ApproveAsync(factory, client, Email);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
                foreach (var row in db.TrustedDevices.Where(d => d.UserId == id))
                {
                    row.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
                }

                await db.SaveChangesAsync();
            }

            (await LoginAsync(client, Email, Password, device)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task TurningItOff_NeedsThePassword_AndForgetsEveryDevice()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Email, requireCode: true);
            using var client = factory.CreateClient();
            var device = await ApproveAsync(factory, client, Email);
            var token = await AccessTokenAsync(await LoginAsync(client, Email, Password, device));

            (await PutAsync(client, new { enabled = false, currentPassword = "Wrong-passphrase-1234" }, token))
                .StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await UserAsync(factory, id)).RequireDeviceCode.Should().BeTrue();

            (await PutAsync(client, new { enabled = false, currentPassword = Password }, token)).StatusCode.Should().Be(HttpStatusCode.OK);

            (await UserAsync(factory, id)).RequireDeviceCode.Should().BeFalse();
            (await Devices(factory, id)).Should().BeEmpty();
            (await LoginAsync(client, Email, Password)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task TheSetting_NeedsASession()
        {
            using var factory = NoCooldown();
            using var client = factory.CreateClient();

            (await client.GetAsync(SettingPath)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await client.PutAsJsonAsync(SettingPath, new { enabled = true, currentPassword = Password })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task TheStoredHash_IsNotTheToken_AndTheLabelIsCleaned()
        {
            using var factory = NoCooldown();
            var id = await CreateAccountAsync(factory, Email);
            using var client = factory.CreateClient();
            var token = await AccessTokenAsync(await LoginAsync(client, Email, Password));

            var ok = await PutAsync(client, new { enabled = true, currentPassword = Password }, token, label: "Evil\r\nLabel " + new string('x', 200));

            ok.StatusCode.Should().Be(HttpStatusCode.OK);
            var row = (await Devices(factory, id)).Should().ContainSingle().Subject;
            row.TokenHash.Should().HaveCount(32);
            row.Label.Should().NotContainAny("\r", "\n");
            row.Label.Length.Should().BeLessThanOrEqualTo(80);
        }

        private static AccountRecoveryFactory NoCooldown() =>
            new(configureCodes: c =>
            {
                c.ResendCooldown = TimeSpan.Zero;
                c.MaxPerHour = 100;
                c.MaxPerDay = 100;
            });

        private static List<OutboundEmail> Codes(AccountRecoveryFactory factory) =>
            factory.AlreadyRegisteredNotices.Where(m => m.Kind == EmailKind.Code).ToList();

        private static string CodeFor(AccountRecoveryFactory factory, string? to = null) =>
            Codes(factory).Last(m => to is null || string.Equals(m.To, to, StringComparison.OrdinalIgnoreCase)).CodeFromBody();

        /// <summary>Runs the whole new-device flow for an account and returns its device token.</summary>
        private static async Task<string> ApproveAsync(AccountRecoveryFactory factory, HttpClient client, string email)
        {
            (await LoginAsync(client, email, Password)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            var verify = await client.PostAsJsonAsync("/account/login/device", new { email, password = Password, code = CodeFor(factory, email) });
            verify.StatusCode.Should().Be(HttpStatusCode.OK);
            return verify.Headers.GetValues(DeviceTrustService.IssuedTokenHeader).Single();
        }

        private static async Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string password, string? device = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/account/login") { Content = JsonContent.Create(new { email, password }) };
            if (device is not null)
            {
                request.Headers.Add(DeviceTrustService.TokenHeader, device);
            }

            return await client.SendAsync(request);
        }

        private static async Task<string> AccessTokenAsync(HttpResponseMessage response) =>
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;

        private static async Task<HttpResponseMessage> GetAsync(HttpClient client, string path, string token, string? device = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (device is not null)
            {
                request.Headers.Add(DeviceTrustService.TokenHeader, device);
            }

            return await client.SendAsync(request);
        }

        private static async Task<HttpResponseMessage> PutAsync(HttpClient client, object body, string token, string? label = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, SettingPath) { Content = JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (label is not null)
            {
                request.Headers.TryAddWithoutValidation(DeviceTrustService.LabelHeader, label.Replace("\r\n", " ", StringComparison.Ordinal));
            }

            return await client.SendAsync(request);
        }

        private static async Task<string> CreateAccountAsync(AccountRecoveryFactory factory, string email, bool requireCode = false)
        {
            using var scope = factory.Services.CreateScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true, RequireDeviceCode = requireCode };
            (await manager.CreateAsync(user, Password)).Succeeded.Should().BeTrue();
            return user.Id;
        }

        private static async Task<ApplicationUser> UserAsync(AccountRecoveryFactory factory, string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking().SingleAsync(u => u.Id == id);
        }

        private static async Task<List<TrustedDevice>> Devices(AccountRecoveryFactory factory, string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().TrustedDevices.AsNoTracking().Where(d => d.UserId == id).ToListAsync();
        }
    }
}
