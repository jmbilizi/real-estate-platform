// <copyright file="ProfileEndpointTests.cs" company="PlaceholderCompany">
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
    /// Integration tests for the profile endpoints (GET / PUT / DELETE).
    /// </summary>
    public class ProfileEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task GetProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task GetProfile_ReturnsOk_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"get-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetProfile_ContainsEmailField_WhenAuthenticated()
        {
            var email = $"get-email-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain(email);
        }

        [Fact]
        public async Task GetProfile_ContainsEmptyIntents_ForNewUser()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"get-intents-empty-{Guid.NewGuid()}@example.com", Password);

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("intents").EnumerateArray().Should().BeEmpty();
        }

        [Fact]
        public async Task PutProfile_ReturnsNoContent_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PutAsJsonAsync("/account/profile", new
            {
                firstName = "Jane",
                lastName = "Doe",
            });

            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task PutProfile_UpdatesFields_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-update-{Guid.NewGuid()}@example.com", Password);

            await client.PutAsJsonAsync("/account/profile", new
            {
                firstName = "UpdatedFirst",
                bio = "My bio text",
            });

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("UpdatedFirst");
            body.Should().Contain("My bio text");
        }

        [Fact]
        public async Task PutProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.PutAsJsonAsync("/account/profile", new { firstName = "X" });
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PutProfile_WithUnknownIntent_ReturnsValidationProblem()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-intents-bad-{Guid.NewGuid()}@example.com", Password);

            var requestedIntents = new[] { "buying", "not_a_real_intent" };
            var response = await client.PutAsJsonAsync("/account/profile", new { intents = requestedIntents });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task PutProfile_Intents_ReplacesWholeSet_NotAdditive()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-intents-replace-{Guid.NewGuid()}@example.com", Password);

            var firstIntents = new[] { "buying" };
            var secondIntents = new[] { "selling" };
            await client.PutAsJsonAsync("/account/profile", new { intents = firstIntents });
            await client.PutAsJsonAsync("/account/profile", new { intents = secondIntents });

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var intents = body.GetProperty("intents").EnumerateArray()
                .Select(e => e.GetString())
                .ToArray();

            intents.Should().BeEquivalentTo(secondIntents);
        }

        [Fact]
        public async Task PutProfile_Intents_EmptyArrayClearsAll()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"put-intents-clear-{Guid.NewGuid()}@example.com", Password);

            var initialIntents = new[] { "buying", "owning" };
            var emptyIntents = Array.Empty<string>();
            await client.PutAsJsonAsync("/account/profile", new { intents = initialIntents });
            await client.PutAsJsonAsync("/account/profile", new { intents = emptyIntents });

            var response = await client.GetAsync("/account/profile");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("intents").EnumerateArray().Should().BeEmpty();
        }

        [Fact]
        public async Task DeleteProfile_ReturnsNoContent_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"delete-profile-{Guid.NewGuid()}@example.com", Password);

            var response = await client.DeleteAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task DeleteProfile_RevokesSession_SubsequentRequestReturnsUnauthorized()
        {
            // After soft-delete, the security stamp is rotated — the existing cookie is
            // immediately invalid, so the server returns 401 before ever reaching the
            // soft-delete guard that would otherwise return 404.
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"delete-twice-{Guid.NewGuid()}@example.com", Password);

            await client.DeleteAsync("/account/profile");

            var response = await client.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task DeleteProfile_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.DeleteAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
    }
}
