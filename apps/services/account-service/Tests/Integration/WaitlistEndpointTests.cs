// <copyright file="WaitlistEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the early-access waitlist endpoints
    /// (GET/POST /account/waitlist, DELETE /account/waitlist/{interest}).
    /// </summary>
    public class WaitlistEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task GetWaitlist_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.GetAsync("/account/waitlist");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PostWaitlist_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task DeleteWaitlist_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.DeleteAsync("/account/waitlist/connect");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task GetWaitlist_ReturnsEmptyList_ForNewAccount()
        {
            var client = await this.AuthenticateAsync("waitlist-empty");

            var response = await client.GetAsync("/account/waitlist");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadInterestsAsync(response)).Should().BeEmpty();
        }

        [Fact]
        public async Task PostWaitlist_RegistersInterest_ReadableOnRevisit()
        {
            var client = await this.AuthenticateAsync("waitlist-register");

            var post = await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            post.StatusCode.Should().Be(HttpStatusCode.NoContent);

            var interests = await ReadInterestsAsync(client);
            interests.Should().Equal("connect");
        }

        [Fact]
        public async Task PostWaitlist_IsIdempotent_JoiningTwiceIsOneRegistration()
        {
            var client = await this.AuthenticateAsync("waitlist-idempotent");

            var first = await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            var second = await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            first.StatusCode.Should().Be(HttpStatusCode.NoContent);
            second.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await ReadInterestsAsync(client)).Should().Equal("connect");
        }

        [Fact]
        public async Task PostWaitlist_RegisteredAtSurvivesARepeatedJoin()
        {
            // The cohort date is the first join, not the latest one — the waitlist-to-active
            // conversion metric depends on it (PRD §16).
            var client = await this.AuthenticateAsync("waitlist-cohort-date");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            var firstRegisteredAt = await ReadRegisteredAtAsync(client, "connect");

            await Task.Delay(10);
            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            var secondRegisteredAt = await ReadRegisteredAtAsync(client, "connect");

            secondRegisteredAt.Should().Be(firstRegisteredAt);
        }

        [Fact]
        public async Task PostWaitlist_AcceptsAllThreeInterestsOnOneAccount()
        {
            // Multi-role model (PRD §11.2): interest in each pillar is independent, and an account
            // may want to hire providers, offer services, and join Connect at the same time.
            var client = await this.AuthenticateAsync("waitlist-all-three");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "services-consumer" });
            await client.PostAsJsonAsync("/account/waitlist", new { interest = "services-provider" });
            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            var interests = await ReadInterestsAsync(client);
            interests.Should().BeEquivalentTo("services-consumer", "services-provider", "connect");
        }

        [Fact]
        public async Task DeleteWaitlist_WithdrawsOnlyTheNamedInterest()
        {
            var client = await this.AuthenticateAsync("waitlist-withdraw-one");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "services-consumer" });
            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            var response = await client.DeleteAsync("/account/waitlist/connect");

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await ReadInterestsAsync(client)).Should().Equal("services-consumer");
        }

        [Fact]
        public async Task DeleteWaitlist_ReturnsSuccess_WhenInterestWasNeverRegistered()
        {
            var client = await this.AuthenticateAsync("waitlist-withdraw-absent");

            var response = await client.DeleteAsync("/account/waitlist/connect");

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await ReadInterestsAsync(client)).Should().BeEmpty();
        }

        [Fact]
        public async Task DeleteWaitlist_IsIdempotent_WithdrawingTwiceSucceeds()
        {
            var client = await this.AuthenticateAsync("waitlist-withdraw-twice");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            var first = await client.DeleteAsync("/account/waitlist/connect");
            var second = await client.DeleteAsync("/account/waitlist/connect");

            first.StatusCode.Should().Be(HttpStatusCode.NoContent);
            second.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task PostWaitlist_RegisterAfterWithdraw_Succeeds()
        {
            var client = await this.AuthenticateAsync("waitlist-rejoin");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            await client.DeleteAsync("/account/waitlist/connect");
            var rejoin = await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            rejoin.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await ReadInterestsAsync(client)).Should().Equal("connect");
        }

        [Theory]
        [InlineData("homes")]
        [InlineData("Connect")]
        [InlineData("services_consumer")]
        public async Task PostWaitlist_WithUnknownInterest_ReturnsValidationProblem(string interest)
        {
            var client = await this.AuthenticateAsync($"waitlist-bad-post-{interest}");

            var response = await client.PostAsJsonAsync("/account/waitlist", new { interest });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await ReadInterestsAsync(client)).Should().BeEmpty();
        }

        [Fact]
        public async Task PostWaitlist_WithMissingInterest_ReturnsValidationProblem()
        {
            var client = await this.AuthenticateAsync("waitlist-missing-interest");

            var response = await client.PostAsJsonAsync("/account/waitlist", new { });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task DeleteWaitlist_WithUnknownInterest_ReturnsSuccess()
        {
            // Withdrawal treats an unknown kind exactly like an absent one. That keeps a row
            // withdrawable after its kind leaves the vocabulary.
            var client = await this.AuthenticateAsync("waitlist-unknown-delete");

            var response = await client.DeleteAsync("/account/waitlist/homes");

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task DeleteWaitlist_WithUnknownInterest_RemovesNothing()
        {
            var client = await this.AuthenticateAsync("waitlist-unknown-delete-noop");

            await client.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });
            await client.DeleteAsync("/account/waitlist/homes");

            (await ReadInterestsAsync(client)).Should().Equal("connect");
        }

        [Fact]
        public async Task PostWaitlist_ValidationMessage_DoesNotEchoTheRejectedValue()
        {
            var client = await this.AuthenticateAsync("waitlist-no-echo");
            const string Rejected = "not-a-pillar-<script>";

            var response = await client.PostAsJsonAsync("/account/waitlist", new { interest = Rejected });
            var body = await response.Content.ReadAsStringAsync();

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            body.Should().NotContain("not-a-pillar");
        }

        [Fact]
        public async Task Waitlist_IsScopedToTheCallingAccount()
        {
            var owner = await this.AuthenticateAsync("waitlist-owner");
            var other = await this.AuthenticateAsync("waitlist-other");

            await owner.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            (await ReadInterestsAsync(owner)).Should().Equal("connect");
            (await ReadInterestsAsync(other)).Should().BeEmpty();
        }

        [Fact]
        public async Task DeleteWaitlist_ByAnotherAccount_LeavesTheOwnersInterestIntact()
        {
            var owner = await this.AuthenticateAsync("waitlist-delete-owner");
            var other = await this.AuthenticateAsync("waitlist-delete-other");

            await owner.PostAsJsonAsync("/account/waitlist", new { interest = "connect" });

            // The account id comes from the principal, so this only ever targets the caller's own
            // rows. It reports success and removes nothing.
            var response = await other.DeleteAsync("/account/waitlist/connect");

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await ReadInterestsAsync(owner)).Should().Equal("connect");
        }

        private static async Task<string[]> ReadInterestsAsync(HttpResponseMessage response)
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("interests").EnumerateArray()
                .Select(e => e.GetProperty("interest").GetString()!)
                .ToArray();
        }

        private static async Task<DateTime> ReadRegisteredAtAsync(HttpClient client, string interest)
        {
            var response = await client.GetAsync("/account/waitlist");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("interests").EnumerateArray()
                .Single(e => e.GetProperty("interest").GetString() == interest)
                .GetProperty("registeredAt").GetDateTime();
        }

        private static async Task<string[]> ReadInterestsAsync(HttpClient client)
        {
            var response = await client.GetAsync("/account/waitlist");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            return await ReadInterestsAsync(response);
        }

        private Task<HttpClient> AuthenticateAsync(string prefix) =>
            AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"{prefix}-{Guid.NewGuid()}@example.com", Password);
    }
}
