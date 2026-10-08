// <copyright file="PostmarkWebhookEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the Postmark webhook (#664) and for the sign-up paths that read what it
    /// writes. The payloads follow Postmark's documented Bounce, SpamComplaint and SubscriptionChange
    /// webhook bodies.
    /// </summary>
    public class PostmarkWebhookEndpointTests
    {
        private const string Path = "/account/webhooks/postmark";
        private const string User = "postmark";
        private const string Password = "webhook-secret-value";
        private const string Address = "Bounced.Person@Example.com";
        private const string Key = "BOUNCED.PERSON@EXAMPLE.COM";

        [Fact]
        public async Task NoCredentials_Returns401_AndWritesNothing()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            using var content = Json(HardBounce(Address));
            var response = await client.PostAsync(Path, content);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            response.Headers.WwwAuthenticate.Should().ContainSingle().Which.Scheme.Should().Be("Basic");
            (await Rows(factory)).Should().BeEmpty();
        }

        [Theory]
        [InlineData("postmark", "wrong-secret")]
        [InlineData("other", Password)]
        [InlineData("", "")]
        public async Task WrongCredentials_Return401_AndWriteNothing(string user, string password)
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, HardBounce(Address), user, password);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task MalformedBasicHeader_Returns401()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, Path) { Content = Json(HardBounce(Address)) };
            request.Headers.TryAddWithoutValidation("Authorization", "Basic not-base64!!");

            (await client.SendAsync(request)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task WhenCredentialsAreNotConfigured_EveryCallReturns401()
        {
            using var factory = new WebhookFactory(user: string.Empty, password: string.Empty);
            using var client = factory.CreateClient();

            var response = await Post(client, HardBounce(Address), string.Empty, string.Empty);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task WhenUserAndPasswordAreTheCommittedPlaceholder_EveryCallReturns401()
        {
            var placeholder = PostmarkOptions.PlaceholderServerToken;
            using var factory = new WebhookFactory(user: placeholder, password: placeholder);
            using var client = factory.CreateClient();

            var response = await Post(client, HardBounce(Address), placeholder, placeholder);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task HardBounce_SuppressesTheNormalizedAddress()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, HardBounce(Address));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var row = (await Rows(factory)).Should().ContainSingle().Subject;
            row.Email.Should().Be(Key);
            row.Reason.Should().Be("HardBounce");
            row.Source.Should().Be("postmark-webhook");
        }

        [Fact]
        public async Task SoftBounce_LeavesTheAddressActive()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, SoftBounce(Address));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task SpamComplaint_SuppressesTheAddress()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, SpamComplaint(Address));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var row = (await Rows(factory)).Should().ContainSingle().Subject;
            row.Email.Should().Be(Key);
            row.Reason.Should().Be("SpamComplaint");
        }

        [Theory]
        [InlineData("HardBounce")]
        [InlineData("SpamComplaint")]
        [InlineData("ManualSuppression")]
        public async Task SubscriptionChange_WithSuppressSending_SuppressesWithPostmarksReason(string reason)
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, SubscriptionChange(Address, suppress: true, reason));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().ContainSingle().Which.Reason.Should().Be(reason);
        }

        [Fact]
        public async Task SubscriptionChange_WithoutSuppressSending_RemovesTheRow()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, HardBounce(Address));

            var response = await Post(client, SubscriptionChange(Address, suppress: false, reason: null));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task ReactivatingAnAddressWithNoRow_DoesNothing()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, SubscriptionChange(Address, suppress: false, reason: null));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task RepeatedEvent_ChangesNothingTheSecondTime()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            (await Post(client, HardBounce(Address))).StatusCode.Should().Be(HttpStatusCode.OK);
            var first = (await Rows(factory)).Should().ContainSingle().Subject;
            (await Post(client, HardBounce(Address))).StatusCode.Should().Be(HttpStatusCode.OK);
            (await Post(client, SpamComplaint(Address))).StatusCode.Should().Be(HttpStatusCode.OK);

            var rows = await Rows(factory);
            rows.Should().ContainSingle();
            rows[0].Id.Should().Be(first.Id);
            rows[0].Reason.Should().Be("HardBounce");
        }

        [Fact]
        public async Task EventOnAnotherMessageStream_IsIgnored()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, HardBounce(Address, stream: "broadcast"));

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Theory]
        [InlineData("""{ "RecordType": "Delivery", "Recipient": "a@example.com" }""")]
        [InlineData("""{ "RecordType": "Bounce", "Inactive": true, "Email": "not an address" }""")]
        [InlineData("""{ "RecordType": "SubscriptionChange", "Recipient": "a@example.com" }""")]
        public async Task EventTheServiceDoesNotActOn_Returns200_SoPostmarkDoesNotRetry(string body)
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, body);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Theory]
        [InlineData("{ not json")]
        [InlineData("null")]
        [InlineData("""{ "Email": "a@example.com" }""")]
        public async Task BadBody_Returns400(string body)
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await Post(client, body);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await Rows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task OversizedBody_Returns413()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            var body = "{ \"RecordType\": \"Bounce\", \"Description\": \"" + new string('x', 70 * 1024) + "\" }";

            var response = await Post(client, body);

            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        }

        [Fact]
        public async Task Webhook_NeverLogsTheAddress()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            await Post(client, HardBounce(Address));
            await Post(client, SpamComplaint(Address));
            await Post(client, HardBounce(Address), User, "wrong");

            var logged = string.Join('\n', factory.Logs.Entries.Select(e => e.Message));
            logged.Should().NotContainEquivalentOf("bounced.person");
            logged.Should().NotContain(Password);
            factory.Logs.Entries.Should().Contain(e => e.EventId.Id == 1390);
            factory.Logs.Entries.Should().Contain(e => e.EventId.Id == 1391);
        }

        [Fact]
        public async Task SuppressedAddress_GetsUndeliverable_OnSignUpStart()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, HardBounce(Address));

            var response = await client.PostAsJsonAsync("/account/signup/start", new { email = " " + Address + " " });

            response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("undeliverable");
            (await PendingRows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task SuppressedAddress_GetsUndeliverable_OnResend_AndChangeEmail()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, SpamComplaint(Address));
            await Post(client, SpamComplaint("Second.Bounced@Example.com"));
            (await client.PostAsJsonAsync("/account/signup/start", new { email = "first@example.com" })).StatusCode.Should().Be(HttpStatusCode.OK);

            var resend = await client.PostAsJsonAsync("/account/signup/resend", new { email = Address });
            var change = await client.PostAsJsonAsync("/account/signup/change-email", new { oldEmail = "first@example.com", newEmail = "Second.Bounced@Example.com" });

            resend.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            change.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

            // The refused change keeps the first sign-up.
            (await PendingRows(factory)).Should().ContainSingle().Which.Email.Should().Be("FIRST@EXAMPLE.COM");
        }

        [Fact]
        public async Task SuppressedAddress_GetsUndeliverable_OnIdentify()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, HardBounce(Address));

            var response = await client.PostAsJsonAsync("/account/identify", new { email = Address });

            response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("undeliverable");
        }

        [Fact]
        public async Task SuppressedAddress_InsideTheSendCooldown_StillGetsUndeliverable_OnIdentify()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            (await client.PostAsJsonAsync("/account/identify", new { email = Address })).StatusCode.Should().Be(HttpStatusCode.OK);
            await Post(client, HardBounce(Address));

            var response = await client.PostAsJsonAsync("/account/identify", new { email = Address });

            response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        }

        [Fact]
        public async Task SuppressedAddress_StaysNeutral_OnPasswordResetStart()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, HardBounce(Address));

            var suppressed = await client.PostAsJsonAsync("/account/password/reset/start", new { email = Address });
            var other = await client.PostAsJsonAsync("/account/password/reset/start", new { email = "someone.else@example.com" });

            suppressed.StatusCode.Should().Be(HttpStatusCode.OK);
            (await suppressed.Content.ReadAsStringAsync()).Should().Be(await other.Content.ReadAsStringAsync());
        }

        [Fact]
        public async Task ReactivatedAddress_SignsUpAgain()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            await Post(client, HardBounce(Address));
            await Post(client, SubscriptionChange(Address, suppress: false, reason: null));

            var response = await client.PostAsJsonAsync("/account/signup/start", new { email = Address });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task DomainWithNoMailRecords_GetsUndeliverable_OnStartAndIdentify()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            factory.MailDomains.Set("no-mail.example", MailDomainStatus.CannotReceiveMail);

            var start = await client.PostAsJsonAsync("/account/signup/start", new { email = "person@no-mail.example" });
            var identify = await client.PostAsJsonAsync("/account/identify", new { email = "other@no-mail.example" });

            start.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            identify.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            (await PendingRows(factory)).Should().BeEmpty();
        }

        [Fact]
        public async Task DnsFailure_FailsOpen_AndSignUpStarts()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();
            factory.MailDomains.Default = MailDomainStatus.Unknown;

            var response = await client.PostAsJsonAsync("/account/signup/start", new { email = "person@slow-dns.example" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await PendingRows(factory)).Should().ContainSingle();
        }

        [Fact]
        public async Task DisposableDomain_IsNotBlocked()
        {
            using var factory = new WebhookFactory();
            using var client = factory.CreateClient();

            var response = await client.PostAsJsonAsync("/account/signup/start", new { email = "person@mailinator.com" });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");

        private static async Task<HttpResponseMessage> Post(HttpClient client, string body, string user = User, string password = Password)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Path) { Content = Json(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{password}")));
            return await client.SendAsync(request);
        }

        // Shapes follow Postmark's webhook documentation. Fields this service ignores are trimmed.
        private static string HardBounce(string email, string stream = "outbound") => $$"""
            { "RecordType": "Bounce", "ID": 4323372036854775807, "Type": "HardBounce", "TypeCode": 1, "Name": "Hard bounce",
              "Tag": "Invitation", "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483", "Description": "The server was unable to deliver your message.",
              "Email": "{{email}}", "From": "no-reply@cribstop.com", "BouncedAt": "2026-10-07T12:00:00Z", "Inactive": true,
              "DumpAvailable": true, "CanActivate": true, "Subject": "Your code", "MessageStream": "{{stream}}" }
            """;

        private static string SoftBounce(string email) => $$"""
            { "RecordType": "Bounce", "Type": "SoftBounce", "TypeCode": 4096, "Email": "{{email}}", "Inactive": false,
              "CanActivate": true, "MessageStream": "outbound" }
            """;

        private static string SpamComplaint(string email) => $$"""
            { "RecordType": "SpamComplaint", "ID": 42, "Type": "SpamComplaint", "TypeCode": 100001, "Email": "{{email}}",
              "From": "no-reply@cribstop.com", "BouncedAt": "2026-10-07T12:00:00Z", "Inactive": true, "CanActivate": false,
              "MessageStream": "outbound" }
            """;

        private static string SubscriptionChange(string email, bool suppress, string? reason) => $$"""
            { "RecordType": "SubscriptionChange", "MessageID": "883953f4-6105-42a2-a16a-77a8eac79483", "ServerID": 123456,
              "MessageStream": "outbound", "ChangedAt": "2026-10-07T12:00:00Z", "Recipient": "{{email}}",
              "Origin": "Recipient", "SuppressSending": {{(suppress ? "true" : "false")}},
              "SuppressionReason": {{(reason is null ? "null" : $"\"{reason}\"")}} }
            """;

        private static async Task<List<EmailSuppression>> Rows(AccountServiceFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .EmailSuppressions.AsNoTracking().ToListAsync();
        }

        private static async Task<List<PendingRegistration>> PendingRows(AccountServiceFactory factory)
        {
            using var scope = factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AccountDbContext>()
                .PendingRegistrations.AsNoTracking().ToListAsync();
        }

        private sealed class WebhookFactory(string user = User, string password = Password) : AccountServiceFactory
        {
            protected override void ConfigureWebHost(IWebHostBuilder builder)
            {
                base.ConfigureWebHost(builder);
                builder.ConfigureServices(services => services.PostConfigure<PostmarkOptions>(options =>
                {
                    options.WebhookUser = user;
                    options.WebhookPassword = password;
                }));
            }
        }
    }
}
