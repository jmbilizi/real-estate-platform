// <copyright file="ApiKeyEndpointTests.cs" company="PlaceholderCompany">
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
    /// Integration tests for the API key management endpoints (POST / GET / DELETE).
    /// </summary>
    public class ApiKeyEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task PostApiKey_ReturnsCreated_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-create-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PostAsJsonAsync("/account/api-keys", new
            {
                name = "My CI Key",
            });

            response.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        [Fact]
        public async Task PostApiKey_ReturnsKeyWithRepPrefix_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-prefix-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PostAsJsonAsync("/account/api-keys", new
            {
                name = "CI Key",
            });

            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("rep_");
        }

        [Fact]
        public async Task PostApiKey_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.PostAsJsonAsync("/account/api-keys", new { name = "X" });
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task PostApiKey_ReturnsBadRequest_WhenExpiryIsInPast()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-expiry-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PostAsJsonAsync("/account/api-keys", new
            {
                name = "Expired Key",
                expiresAt = DateTime.UtcNow.AddDays(-1),
            });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task GetApiKeys_ReturnsOk_WhenAuthenticated()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-list-{Guid.NewGuid()}@example.com", Password);

            var response = await client.GetAsync("/account/api-keys");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetApiKeys_ReturnsEmptyList_BeforeCreatingAny()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-empty-{Guid.NewGuid()}@example.com", Password);

            var response = await client.GetAsync("/account/api-keys");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Be("[]");
        }

        [Fact]
        public async Task GetApiKeys_ReturnsOneKey_AfterCreating()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-one-{Guid.NewGuid()}@example.com", Password);

            await client.PostAsJsonAsync("/account/api-keys", new { name = "Test Key" });

            var response = await client.GetAsync("/account/api-keys");
            var body = await response.Content.ReadAsStringAsync();
            var keys = JsonSerializer.Deserialize<JsonElement[]>(body);
            keys.Should().HaveCount(1);
        }

        [Fact]
        public async Task GetApiKeys_DoesNotReturnRawKey_InList()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-noraw-{Guid.NewGuid()}@example.com", Password);

            var createResponse = await client.PostAsJsonAsync("/account/api-keys", new { name = "Hidden Key" });
            var createBody = await createResponse.Content.ReadAsStringAsync();
            var created = JsonSerializer.Deserialize<JsonElement>(createBody);
            var rawKey = created.GetProperty("key").GetString();

            var listResponse = await client.GetAsync("/account/api-keys");
            var listBody = await listResponse.Content.ReadAsStringAsync();
            listBody.Should().NotContain(rawKey!);
        }

        [Fact]
        public async Task DeleteApiKey_ReturnsNoContent_WhenRevoked()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-revoke-{Guid.NewGuid()}@example.com", Password);

            var createResponse = await client.PostAsJsonAsync("/account/api-keys", new { name = "To Revoke" });
            var createBody = await createResponse.Content.ReadAsStringAsync();
            var created = JsonSerializer.Deserialize<JsonElement>(createBody);
            var keyId = created.GetProperty("id").GetString();

            var response = await client.DeleteAsync($"/account/api-keys/{keyId}");
            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task DeleteApiKey_IsIdempotent_WhenAlreadyRevoked()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-idem-{Guid.NewGuid()}@example.com", Password);

            var createResponse = await client.PostAsJsonAsync("/account/api-keys", new { name = "Revoke Twice" });
            var created = JsonSerializer.Deserialize<JsonElement>(await createResponse.Content.ReadAsStringAsync());
            var keyId = created.GetProperty("id").GetString();

            await client.DeleteAsync($"/account/api-keys/{keyId}");
            var second = await client.DeleteAsync($"/account/api-keys/{keyId}");
            second.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        [Fact]
        public async Task DeleteApiKey_ReturnsNotFound_ForOtherUsersKey()
        {
            var clientA = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-owner-{Guid.NewGuid()}@example.com", Password);
            var clientB = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-thief-{Guid.NewGuid()}@example.com", Password);

            var createResponse = await clientA.PostAsJsonAsync("/account/api-keys", new { name = "Private Key" });
            var created = JsonSerializer.Deserialize<JsonElement>(await createResponse.Content.ReadAsStringAsync());
            var keyId = created.GetProperty("id").GetString();

            var response = await clientB.DeleteAsync($"/account/api-keys/{keyId}");
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        [Fact]
        public async Task ApiKeyAuth_GrantsAccess_WhenValidKeyProvided()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-auth-{Guid.NewGuid()}@example.com", Password);

            var createResponse = await client.PostAsJsonAsync("/account/api-keys", new { name = "Auth Key" });
            var created = JsonSerializer.Deserialize<JsonElement>(await createResponse.Content.ReadAsStringAsync());
            var rawKey = created.GetProperty("key").GetString();

            // Use a fresh unauthenticated client with only the X-Api-Key header
            var keyClient = factory.CreateClient();
            keyClient.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await keyClient.GetAsync("/account/profile");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task PostApiKey_ReturnsBadRequest_WhenAppIdIsNotAllowed()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-badapp-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PostAsJsonAsync("/account/api-keys", new
            {
                name = "Key with bad app",
                appId = "not-a-real-app",
            });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task PostApiKey_ReturnsCreated_WhenAppIdIsAllowed()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"apikey-goodapp-{Guid.NewGuid()}@example.com", Password);

            var response = await client.PostAsJsonAsync("/account/api-keys", new
            {
                name = "Key with valid app",
                appId = "cribstop",
            });

            response.StatusCode.Should().Be(HttpStatusCode.Created);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("\"appId\":\"cribstop\"");
        }
    }
}
