// <copyright file="CredentialIntrospectionEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for internal forwarded-credential introspection.
    /// </summary>
    public class CredentialIntrospectionEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";
        private const string EndpointPath = "/internal/account/introspect";

        [Fact]
        public async Task IntrospectCookieCredential_ReturnsValidAccountId()
        {
            var cookieHeader = await AuthHelper.CreateSessionCookieHeaderAsync(
                factory,
                $"introspect-cookie-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", cookieHeader);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Headers.CacheControl!.NoStore.Should().BeTrue();

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("cookie");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectBearerCredential_ReturnsValidAccountId()
        {
            var token = await AuthHelper.CreateBearerTokenAsync(
                factory,
                $"introspect-bearer-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("bearer");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectApiKeyCredential_ReturnsValidAccountId()
        {
            var authenticatedClient = await AuthHelper.CreateAuthenticatedClientAsync(
                factory,
                $"introspect-apikey-{Guid.NewGuid()}@example.com",
                Password);

            var createResponse = await authenticatedClient.PostAsJsonAsync("/account/api-keys", new
            {
                name = "Introspection key",
            });
            createResponse.StatusCode.Should().Be(HttpStatusCode.Created);

            var createdPayload = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync()).RootElement;
            var rawKey = createdPayload.GetProperty("key").GetString();
            rawKey.Should().NotBeNullOrWhiteSpace();

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectRevokedCookieSession_ReturnsInvalidAndRevoked()
        {
            var email = $"introspect-revoked-{Guid.NewGuid()}@example.com";
            var cookieHeader = await AuthHelper.CreateSessionCookieHeaderAsync(factory, email, Password);

            var sessionClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });

            var loginResponse = await sessionClient.PostAsJsonAsync("/account/login?useCookies=true", new
            {
                email,
                password = Password,
            });
            loginResponse.EnsureSuccessStatusCode();

            var deleteResponse = await sessionClient.DeleteAsync("/account/profile");
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            var introspectionClient = factory.CreateClient();
            introspectionClient.DefaultRequestHeaders.Add("Cookie", cookieHeader);
            var response = await introspectionClient.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("cookie");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeTrue();
        }

        [Fact]
        public async Task IntrospectNoCredential_ReturnsInvalidWithTypeNone()
        {
            var client = factory.CreateClient();

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("none");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectApiKeyForDeletedAccount_ReturnsInvalidAndRevoked()
        {
            var email = $"introspect-apikey-revoked-{Guid.NewGuid()}@example.com";
            var authenticatedClient = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);

            var createResponse = await authenticatedClient.PostAsJsonAsync("/account/api-keys", new
            {
                name = "Revocation test key",
            });
            createResponse.StatusCode.Should().Be(HttpStatusCode.Created);

            var createdPayload = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync()).RootElement;
            var rawKey = createdPayload.GetProperty("key").GetString();
            rawKey.Should().NotBeNullOrWhiteSpace();

            // Soft-delete the account while authenticated.
            var deleteResponse = await authenticatedClient.DeleteAsync("/account/profile");
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            // Attempt introspection with the API key that belonged to the deleted account.
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeTrue();
        }
    }
}
