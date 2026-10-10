// <copyright file="NotificationConsentEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
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
#pragma warning disable CA2000 // The request content lives as long as the test.

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Security and single-source-of-truth tests for notification consent (#694): the internal key,
    /// the bound token category, server-held wording, the legacy flag mirror and account deletion.
    /// </summary>
    public class NotificationConsentEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#Abcd";
        private const string WordingId = "email_non_transactional";
        private const string PolicyPath = "/internal/account/notification-policy";

        [Fact]
        public async Task Policy_RefusesAMissingOrWrongKey_WithA403()
        {
            var body = new { items = new[] { Query(Guid.NewGuid().ToString("D"), "marketing") } };

            (await factory.CreateClient().PostAsJsonAsync(PolicyPath, body)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

            var wrong = factory.CreateClient();
            wrong.DefaultRequestHeaders.Add("X-Internal-Key", "wrong-key-wrong-key-wrong-key-wrong-key");
            (await wrong.PostAsJsonAsync(PolicyPath, body)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        [Fact]
        public async Task Policy_WithNoConfiguredKey_RefusesEveryCall()
        {
            using var unset = factory.WithWebHostBuilder(b => b.ConfigureServices(services =>
                services.PostConfigure<InternalCallerOptions>(o => o.Key = string.Empty)));
            var client = unset.CreateClient();
            client.DefaultRequestHeaders.Add("X-Internal-Key", AccountServiceFactory.InternalKey);

            var response = await client.PostAsJsonAsync(PolicyPath, new { items = new[] { Query(Guid.NewGuid().ToString("D"), "marketing") } });

            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        [Fact]
        public async Task Policy_OmitsTheTokenUnlessAsked()
        {
            var (client, id) = await NewAccountAsync("nc-notoken");
            await OptInAsync(client);

            var plain = (await PolicyAsync(Query(id, "marketing")))[0];
            var asked = (await PolicyAsync(Query(id, "marketing", true)))[0];

            plain.GetProperty("allowed").GetBoolean().Should().BeTrue();
            plain.GetProperty("unsubscribeToken").ValueKind.Should().Be(JsonValueKind.Null);
            asked.GetProperty("unsubscribeToken").ValueKind.Should().Be(JsonValueKind.String);
        }

        [Theory]
        [InlineData("transactional")]
        [InlineData("marketing")]
        [InlineData("sms")]
        public async Task Unsubscribe_RefusesATokenForAnotherCategory_AndChangesNothing(string category)
        {
            var (client, id) = await NewAccountAsync("nc-cat");
            await OptInAsync(client);
            var token = factory.Services.GetRequiredService<UnsubscribeTokenService>().Create(id, category);

            var response = await factory.CreateClient().PostAsync($"/notifications/unsubscribe?t={token}", OneClick());

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await EmailEnabledAsync(client)).Should().BeTrue();
        }

        [Fact]
        public async Task Put_UnknownWordingId_Returns400_AndStoresNothing()
        {
            var (client, id) = await NewAccountAsync("nc-badwording");
            var response = await client.PutAsJsonAsync(
                "/account/notification-preferences",
                new { items = new[] { new { channel = "email", category = "non_transactional", enabled = true, consentWordingId = "free text from the client" } } });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("unknown_consent_wording");
            (await RowCountAsync(id)).Should().Be(0);
        }

        [Fact]
        public async Task Get_ReturnsTheServerHeldWording()
        {
            var (client, _) = await NewAccountAsync("nc-wording");
            var body = await (await client.GetAsync("/account/notification-preferences")).Content.ReadFromJsonAsync<JsonElement>();

            body.GetProperty("consentWording").GetProperty("id").GetString().Should().Be(WordingId);
            body.GetProperty("consentWording").GetProperty("text").GetString().Should().NotBeNullOrWhiteSpace();
        }

        [Fact]
        public async Task OptIn_AndOptOut_AreMirroredToTheLegacyFlag()
        {
            var (client, id) = await NewAccountAsync("nc-legacy");
            (await LegacyEmailFlagAsync(id)).Should().BeFalse();

            await OptInAsync(client);
            (await LegacyEmailFlagAsync(id)).Should().BeTrue();

            await client.PutAsJsonAsync("/account/notification-preferences", Body(false));
            (await LegacyEmailFlagAsync(id)).Should().BeFalse();
        }

        [Fact]
        public async Task Unsubscribe_ClearsTheLegacyFlag_EvenWhenTheRowWasAlreadyOff()
        {
            var (client, id) = await NewAccountAsync("nc-legacy-unsub");
            await OptInAsync(client);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
                (await db.Users.SingleAsync(u => u.Id == id)).EmailNotificationsEnabled = true;
                (await db.NotificationPreferences.SingleAsync(p => p.AccountId == id)).Enabled = false;
                await db.SaveChangesAsync();
            }

            var token = factory.Services.GetRequiredService<UnsubscribeTokenService>().Create(id, "non_transactional");
            await factory.CreateClient().PostAsync($"/notifications/unsubscribe?t={token}", OneClick());

            (await LegacyEmailFlagAsync(id)).Should().BeFalse();
        }

        [Fact]
        public async Task ProfileToggle_Off_WritesThroughTheConsentRecord()
        {
            var (client, id) = await NewAccountAsync("nc-profile-off");
            await OptInAsync(client);

            var response = await client.PutAsJsonAsync("/account/profile", new { emailNotificationsEnabled = false });

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await LegacyEmailFlagAsync(id)).Should().BeFalse();
            (await EmailEnabledAsync(client)).Should().BeFalse();
            using var scope = factory.Services.CreateScope();
            (await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferenceAudits
                .CountAsync(a => a.AccountId == id && !a.Enabled)).Should().Be(1);
        }

        [Fact]
        public async Task ProfileToggle_On_WithoutAConsentRecord_IsRefused_AndStoresNothing()
        {
            var (client, id) = await NewAccountAsync("nc-profile-on");

            var response = await client.PutAsJsonAsync("/account/profile", new { emailNotificationsEnabled = true });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await LegacyEmailFlagAsync(id)).Should().BeFalse();
            (await RowCountAsync(id)).Should().Be(0);
        }

        [Fact]
        public async Task DeletingTheAccount_PurgesConsentAndAuditRows()
        {
            var (client, id) = await NewAccountAsync("nc-delete");
            await OptInAsync(client);
            (await RowCountAsync(id)).Should().Be(1);

            (await client.DeleteAsync("/account/profile")).StatusCode.Should().Be(HttpStatusCode.NoContent);

            (await RowCountAsync(id)).Should().Be(0);
            using var scope = factory.Services.CreateScope();
            (await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferenceAudits
                .CountAsync(a => a.AccountId == id)).Should().Be(0);
        }

        private static object Body(bool enabled) => new
        {
            items = new[] { new { channel = "email", category = "non_transactional", enabled, consentWordingId = WordingId } },
        };

        private static object Query(string accountId, string category, bool includeToken = false) =>
            new { accountId, channel = "email", category, includeUnsubscribeToken = includeToken };

        private static FormUrlEncodedContent OneClick() =>
            new(new Dictionary<string, string> { ["List-Unsubscribe"] = "One-Click" });

        private static Task<HttpResponseMessage> OptInAsync(HttpClient client) =>
            client.PutAsJsonAsync("/account/notification-preferences", Body(true));

        private static async Task<bool> EmailEnabledAsync(HttpClient client)
        {
            var body = await (await client.GetAsync("/account/notification-preferences")).Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("preferences").EnumerateArray()
                .Single(p => p.GetProperty("channel").GetString() == "email").GetProperty("enabled").GetBoolean();
        }

        private async Task<(HttpClient Client, string Id)> NewAccountAsync(string prefix)
        {
            var email = $"{prefix}-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            using var scope = factory.Services.CreateScope();
            var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email);
            return (client, user!.Id);
        }

        private async Task<bool> LegacyEmailFlagAsync(string id)
        {
            using var scope = factory.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<AccountDbContext>().Users.AsNoTracking()
                .SingleAsync(u => u.Id == id)).EmailNotificationsEnabled;
        }

        private async Task<int> RowCountAsync(string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferences
                .CountAsync(p => p.AccountId == id);
        }

        private async Task<List<JsonElement>> PolicyAsync(params object[] queries)
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Internal-Key", AccountServiceFactory.InternalKey);
            var response = await client.PostAsJsonAsync(PolicyPath, new { items = queries });
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("items").EnumerateArray().Select(e => e.Clone()).ToList();
        }
    }
}
