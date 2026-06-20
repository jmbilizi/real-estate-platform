// <copyright file="AdminEndpointTests.cs" company="PlaceholderCompany">
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
    /// Integration tests for the admin role management endpoints.
    /// </summary>
    public class AdminEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";

        [Fact]
        public async Task GetRoles_ReturnsUnauthorized_WhenNotLoggedIn()
        {
            var client = factory.CreateClient();
            var response = await client.GetAsync("/account/some-user-id/roles");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task GetRoles_ReturnsForbidden_WhenAccessingOtherUserWithoutAdminRole()
        {
            var clientA = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-a-{Guid.NewGuid()}@example.com", Password);
            var clientB = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-b-{Guid.NewGuid()}@example.com", Password);

            // Get user A's ID from their profile
            var profileResponse = await clientA.GetAsync("/account/profile");
            var profile = JsonSerializer.Deserialize<JsonElement>(
                await profileResponse.Content.ReadAsStringAsync());
            var userAId = profile.GetProperty("id").GetString();

            // Client B (plain user) tries to read client A's roles — should be forbidden
            var response = await clientB.GetAsync($"/account/{userAId}/roles");
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        [Fact]
        public async Task GetRoles_ReturnsOk_WhenAccessingOwnRoles()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-self-{Guid.NewGuid()}@example.com", Password);

            var profileResponse = await client.GetAsync("/account/profile");
            var profile = JsonSerializer.Deserialize<JsonElement>(
                await profileResponse.Content.ReadAsStringAsync());
            var userId = profile.GetProperty("id").GetString();

            var response = await client.GetAsync($"/account/{userId}/roles");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetRoles_ContainsUserRole_ForNewlyRegisteredUser()
        {
            var client = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-user-{Guid.NewGuid()}@example.com", Password);

            var profile = JsonSerializer.Deserialize<JsonElement>(
                await (await client.GetAsync("/account/profile")).Content.ReadAsStringAsync());
            var userId = profile.GetProperty("id").GetString();

            var rolesResponse = await client.GetAsync($"/account/{userId}/roles");
            var body = await rolesResponse.Content.ReadAsStringAsync();
            body.Should().Contain("User");
        }

        [Fact]
        public async Task PostRole_ReturnsForbidden_WhenCallerIsNotAdmin()
        {
            var clientA = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-post-a-{Guid.NewGuid()}@example.com", Password);
            var clientB = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-post-b-{Guid.NewGuid()}@example.com", Password);

            var profileA = JsonSerializer.Deserialize<JsonElement>(
                await (await clientA.GetAsync("/account/profile")).Content.ReadAsStringAsync());
            var userAId = profileA.GetProperty("id").GetString();

            var response = await clientB.PostAsJsonAsync(
                $"/account/{userAId}/roles", new { role = "Moderator" });

            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        [Fact]
        public async Task DeleteRole_ReturnsForbidden_WhenCallerIsNotAdmin()
        {
            var clientA = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-del-a-{Guid.NewGuid()}@example.com", Password);
            var clientB = await AuthHelper.CreateAuthenticatedClientAsync(
                factory, $"roles-del-b-{Guid.NewGuid()}@example.com", Password);

            var profileA = JsonSerializer.Deserialize<JsonElement>(
                await (await clientA.GetAsync("/account/profile")).Content.ReadAsStringAsync());
            var userAId = profileA.GetProperty("id").GetString();

            var response = await clientB.DeleteAsync($"/account/{userAId}/roles/User");
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }
    }
}
