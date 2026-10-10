// <copyright file="NotificationPreferencesEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

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
#pragma warning disable CA2000 // The request content lives as long as the test.

namespace AccountService.Tests.Integration
{
    /// <summary>Integration tests for notification consent, one-click unsubscribe and the policy lookup (#694).</summary>
    public class NotificationPreferencesEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#Abcd";
        private const string WordingId = "email_non_transactional";
        private const string PolicyPath = "/internal/account/notification-policy";

        [Fact]
        public async Task Routes_RefuseAnonymousCallers()
        {
            var client = factory.CreateClient();
            (await client.GetAsync("/account/notification-preferences")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true))).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Get_DefaultsToNotOptedIn_ForEmailAndSms()
        {
            var (client, _) = await NewAccountAsync("np-default");
            var prefs = await ReadPreferencesAsync(await client.GetAsync("/account/notification-preferences"));

            prefs.Should().HaveCount(2);
            prefs.Should().OnlyContain(p => p.GetProperty("enabled").GetBoolean() == false
                && p.GetProperty("source").GetString() == "default"
                && p.GetProperty("category").GetString() == "non_transactional");
        }

        [Fact]
        public async Task Put_OptIn_StoresTheConsentRecord_AndGetReturnsIt()
        {
            var (client, id) = await NewAccountAsync("np-optin");

            var response = await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var email = (await ReadPreferencesAsync(response)).Single(p => p.GetProperty("channel").GetString() == "email");
            email.GetProperty("enabled").GetBoolean().Should().BeTrue();
            email.GetProperty("source").GetString().Should().Be("user");
            email.GetProperty("consentedAt").ValueKind.Should().Be(JsonValueKind.String);

            using var scope = factory.Services.CreateScope();
            var row = await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferences
                .SingleAsync(p => p.AccountId == id && p.Channel == "email");
            row.ConsentWordingId.Should().Be(WordingId);
            row.ConsentWordingVersion.Should().Be(1);
            row.ConsentedAt.Should().NotBeNull();
        }

        [Fact]
        public async Task Put_OptIn_WithoutWording_Returns400()
        {
            var (client, _) = await NewAccountAsync("np-nowording");
            var response = await client.PutAsJsonAsync(
                "/account/notification-preferences",
                new { items = new[] { new { channel = "email", category = "non_transactional", enabled = true } } });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be("consent_wording_required");
        }

        [Fact]
        public async Task Put_TransactionalCategory_IsRefused_AndStoresNothing()
        {
            var (client, id) = await NewAccountAsync("np-transactional");
            var response = await client.PutAsJsonAsync(
                "/account/notification-preferences",
                new { items = new[] { new { channel = "email", category = "transactional", enabled = false } } });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be("transactional_not_storable");
            (await RowCountAsync(id)).Should().Be(0);
        }

        [Fact]
        public async Task Put_SmsOptIn_Returns409_AndAnInvalidItemStoresNothingFromTheBatch()
        {
            var (client, id) = await NewAccountAsync("np-sms");
            var response = await client.PutAsJsonAsync(
                "/account/notification-preferences",
                new
                {
                    items = new[]
                    {
                        new { channel = "email", category = "non_transactional", enabled = true, consentWordingId = WordingId },
                        new { channel = "sms", category = "non_transactional", enabled = true, consentWordingId = WordingId },
                    },
                });

            response.StatusCode.Should().Be(HttpStatusCode.Conflict);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be("sms_requires_consent");
            (await RowCountAsync(id)).Should().Be(0);
        }

        [Fact]
        public async Task Put_UnknownChannelOrEmptyBody_Returns400()
        {
            var (client, _) = await NewAccountAsync("np-bad");
            (await client.PutAsJsonAsync("/account/notification-preferences", Put("push", true))).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
            (await client.PutAsJsonAsync("/account/notification-preferences", new { })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Changes_WriteAnAuditRow_ButARepeatWritesNone()
        {
            var (client, id) = await NewAccountAsync("np-audit");

            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", false));

            using var scope = factory.Services.CreateScope();
            var audits = await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferenceAudits
                .Where(a => a.AccountId == id).OrderBy(a => a.OccurredAt).ToListAsync();
            audits.Should().HaveCount(2);
            audits[0].Should().Match<NotificationPreferenceAudit>(a =>
                a.Enabled && a.PreviousEnabled == null && a.Source == "user" && a.ActorId == id && a.ConsentWordingId == WordingId && a.ConsentWordingVersion == 1);
            audits[1].Should().Match<NotificationPreferenceAudit>(a => !a.Enabled && a.PreviousEnabled == true);
        }

        [Fact]
        public async Task Unsubscribe_OptsOut_WithoutLogin_AndARepeatIsANoOp()
        {
            var (client, id) = await NewAccountAsync("np-unsub");
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            var token = Tokens().Create(id, "non_transactional");

            var anonymous = factory.CreateClient();
            var first = await anonymous.PostAsync($"/notifications/unsubscribe?t={token}", OneClick());
            var second = await anonymous.PostAsync($"/notifications/unsubscribe?t={token}", OneClick());

            first.StatusCode.Should().Be(HttpStatusCode.OK);
            second.StatusCode.Should().Be(HttpStatusCode.OK);
            var email = (await ReadPreferencesAsync(await client.GetAsync("/account/notification-preferences")))
                .Single(p => p.GetProperty("channel").GetString() == "email");
            email.GetProperty("enabled").GetBoolean().Should().BeFalse();
            email.GetProperty("source").GetString().Should().Be("unsubscribe_link");

            using var scope = factory.Services.CreateScope();
            var audits = await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferenceAudits
                .Where(a => a.AccountId == id && a.Source == "unsubscribe_link").ToListAsync();
            audits.Should().ContainSingle().Which.ActorId.Should().BeNull();
        }

        [Fact]
        public async Task Unsubscribe_ForAnAccountWithNoRow_StoresAnExplicitOptOut()
        {
            var (_, id) = await NewAccountAsync("np-unsub-norow");
            var response = await factory.CreateClient()
                .PostAsync($"/notifications/unsubscribe?t={Tokens().Create(id, "non_transactional")}", OneClick());

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await RowCountAsync(id)).Should().Be(1);
        }

        [Theory]
        [InlineData("")]
        [InlineData("garbage")]
        [InlineData("a.b")]
        public async Task Unsubscribe_RefusesAMissingOrMalformedToken(string token)
        {
            var response = await factory.CreateClient().PostAsync($"/notifications/unsubscribe?t={token}", OneClick());
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Unsubscribe_RefusesATamperedToken_AndChangesNothing()
        {
            var (client, id) = await NewAccountAsync("np-tamper");
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            var (_, otherId) = await NewAccountAsync("np-tamper-other");

            // The signature of one account's token does not fit another account's payload.
            var mine = Tokens().Create(id, "non_transactional")!.Split('.');
            var theirs = Tokens().Create(otherId, "non_transactional")!.Split('.');
            var forged = $"{theirs[0]}.{mine[1]}";

            var response = await factory.CreateClient().PostAsync($"/notifications/unsubscribe?t={forged}", OneClick());

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await RowCountAsync(otherId)).Should().Be(0);
            (await ReadPreferencesAsync(await client.GetAsync("/account/notification-preferences")))
                .Single(p => p.GetProperty("channel").GetString() == "email")
                .GetProperty("enabled").GetBoolean().Should().BeTrue();
        }

        [Fact]
        public async Task Token_HoldsNoEmailAddress()
        {
            var email = $"np-token-{Guid.NewGuid()}@example.com";
            await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            string id;
            using (var scope = factory.Services.CreateScope())
            {
                id = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email))!.Id;
            }

            var token = Tokens().Create(id, "non_transactional")!;
            var payload = System.Text.Encoding.UTF8.GetString(
                Convert.FromBase64String(token.Split('.')[0].Replace('-', '+').Replace('_', '/').PadRight(((token.Split('.')[0].Length + 3) / 4) * 4, '=')));

            payload.Should().NotContain("@").And.NotContain(email);
        }

        [Fact]
        public async Task Policy_MissingConsent_BlocksMarketingAndAlert_ButNotTransactional()
        {
            var (_, id) = await NewAccountAsync("np-policy-default");
            var items = await PolicyAsync(
                Query(id, "email", "marketing"),
                Query(id, "email", "alert"),
                Query(id, "email", "non_transactional"),
                Query(id, "email", "transactional"));

            items.Select(i => i.GetProperty("allowed").GetBoolean()).Should().Equal(false, false, false, true);
            items[3].TryGetProperty("unsubscribeToken", out var transactionalToken).Should().BeTrue();
            transactionalToken.ValueKind.Should().Be(JsonValueKind.Null);
            items[0].GetProperty("emailConfirmed").GetBoolean().Should().BeTrue();
            items[0].GetProperty("suppressed").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task Policy_OptedIn_AllowsMarketing_AndSignsAValidToken()
        {
            var (client, id) = await NewAccountAsync("np-policy-optin");
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));

            var items = await PolicyAsync(Query(id, "email", "marketing", true), Query(id, "sms", "marketing"));

            items[0].GetProperty("allowed").GetBoolean().Should().BeTrue();
            var token = items[0].GetProperty("unsubscribeToken").GetString();
            Tokens().TryValidate(token, out var accountId, out var category).Should().BeTrue();
            accountId.Should().Be(id);
            category.Should().Be("non_transactional");
            items[1].GetProperty("allowed").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task Policy_AfterUnsubscribe_BlocksMarketing()
        {
            var (client, id) = await NewAccountAsync("np-policy-unsub");
            await client.PutAsJsonAsync("/account/notification-preferences", Put("email", true));
            await factory.CreateClient()
                .PostAsync($"/notifications/unsubscribe?t={Tokens().Create(id, "non_transactional")}", OneClick());

            var items = await PolicyAsync(Query(id, "email", "marketing"));

            items[0].GetProperty("allowed").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task Policy_ReportsSuppression()
        {
            var email = $"np-suppressed-{Guid.NewGuid()}@example.com";
            await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            string id;
            using (var scope = factory.Services.CreateScope())
            {
                id = (await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email))!.Id;
                SignUpEmail.TryNormalize(email, out var key, out _);
                await scope.ServiceProvider.GetRequiredService<EmailSuppressionService>()
                    .SuppressAsync(key, EmailSuppression.HardBounce, EmailSuppression.WebhookSource);
            }

            var items = await PolicyAsync(Query(id, "email", "transactional"), Query(id, "sms", "transactional"));

            items[0].GetProperty("suppressed").GetBoolean().Should().BeTrue();
            items[1].GetProperty("suppressed").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task Policy_OmitsUnknownAndDeletedAccounts()
        {
            var (_, live) = await NewAccountAsync("np-policy-live");
            var (_, gone) = await NewAccountAsync("np-policy-gone");
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
                (await db.Users.SingleAsync(u => u.Id == gone)).DeletedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }

            var items = await PolicyAsync(
                Query(live, "email", "marketing"),
                Query(gone, "email", "marketing"),
                Query(Guid.NewGuid().ToString("D"), "email", "marketing"));

            items.Should().ContainSingle().Which.GetProperty("accountId").GetString().Should().Be(live);
        }

        [Fact]
        public async Task Policy_EnforcesBatchLimits_AndRejectsUnknownValues()
        {
            var client = PolicyClient();
            var id = Guid.NewGuid().ToString("D");

            (await client.PostAsJsonAsync(PolicyPath, new { items = Array.Empty<object>() })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(PolicyPath, new { })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(PolicyPath, new { items = Enumerable.Range(0, 101).Select(_ => Query(id, "email", "marketing")) }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(PolicyPath, new { items = Enumerable.Range(0, 100).Select(_ => Query(id, "email", "marketing")) }))
                .StatusCode.Should().Be(HttpStatusCode.OK);
            (await client.PostAsJsonAsync(PolicyPath, new { items = new[] { Query(id, "push", "marketing") } })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(PolicyPath, new { items = new[] { Query(id, "email", "newsletter") } })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
        }

        private static object Put(string channel, bool enabled) => new
        {
            items = new[] { new { channel, category = "non_transactional", enabled, consentWordingId = WordingId } },
        };

        private static object Query(string accountId, string channel, string category, bool includeToken = false) =>
            new { accountId, channel, category, includeUnsubscribeToken = includeToken };

        private static FormUrlEncodedContent OneClick() =>
            new(new Dictionary<string, string> { ["List-Unsubscribe"] = "One-Click" });

        private static async Task<List<JsonElement>> ReadPreferencesAsync(HttpResponseMessage response)
        {
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("preferences").EnumerateArray().Select(e => e.Clone()).ToList();
        }

        private HttpClient PolicyClient()
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Internal-Key", AccountServiceFactory.InternalKey);
            return client;
        }

        private UnsubscribeTokenService Tokens() => factory.Services.GetRequiredService<UnsubscribeTokenService>();

        private async Task<(HttpClient Client, string Id)> NewAccountAsync(string prefix)
        {
            var email = $"{prefix}-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            using var scope = factory.Services.CreateScope();
            var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email);
            return (client, user!.Id);
        }

        private async Task<int> RowCountAsync(string id)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>().NotificationPreferences
                .CountAsync(p => p.AccountId == id);
        }

        private async Task<List<JsonElement>> PolicyAsync(params object[] queries)
        {
            var response = await PolicyClient().PostAsJsonAsync(PolicyPath, new { items = queries });
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("items").EnumerateArray().Select(e => e.Clone()).ToList();
        }
    }
}
