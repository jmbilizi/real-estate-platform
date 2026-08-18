// <copyright file="CredentialIntrospectionEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for internal forwarded-credential introspection.
    /// <para>
    /// Every credential is obtained the way the gateway actually forwards it — a raw <c>Cookie</c>
    /// header parsed off a real <c>Set-Cookie</c>, the real <c>accessToken</c> from a real login, or
    /// the raw key returned once by <c>POST /account/api-keys</c>. Nothing here hand-builds a
    /// principal or a ticket.
    /// </para>
    /// </summary>
    public class CredentialIntrospectionEndpointTests(
        AccountServiceFactory factory,
        ExpiredBearerTokenFactory expiredBearerFactory)
        : IClassFixture<AccountServiceFactory>, IClassFixture<ExpiredBearerTokenFactory>
    {
        private const string Password = "Test1234!@#";
        private const string EndpointPath = "/internal/account/introspect";
        private const string IdentityCookieName = ".AspNetCore.Identity.Application";

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

            var payload = await ReadPayloadAsync(response);
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

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("bearer");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectBearerCredential_WithLowercaseScheme_ReturnsValidAccountId()
        {
            // RFC 7235 §2.1: the auth-scheme token is case-insensitive, and Ocelot forwards headers
            // verbatim. Detection and validation must agree on this, or a valid token reads invalid.
            var token = await AuthHelper.CreateBearerTokenAsync(
                factory,
                $"introspect-bearer-lower-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"bearer {token}");

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("bearer");
        }

        [Fact]
        public async Task BearerAuthentication_WithLowercaseScheme_IsAcceptedByTheServiceItself()
        {
            // The counterpart of the test above: introspection must not report a credential valid
            // that account-service's own endpoints would reject.
            var token = await AuthHelper.CreateBearerTokenAsync(
                factory,
                $"lowercase-bearer-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"bearer {token}");

            var response = await client.GetAsync("/account/profile");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task IntrospectExpiredBearerCredential_ReturnsInvalidAndExpired()
        {
            var token = await AuthHelper.CreateBearerTokenAsync(
                expiredBearerFactory,
                $"introspect-bearer-expired-{Guid.NewGuid()}@example.com",
                Password);

            var client = expiredBearerFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("bearer");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isExpired").GetBoolean().Should().BeTrue();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectApiKeyCredential_ReturnsValidAccountId()
        {
            var authenticatedClient = await AuthHelper.CreateAuthenticatedClientAsync(
                factory,
                $"introspect-apikey-{Guid.NewGuid()}@example.com",
                Password);

            var (rawKey, _) = await CreateApiKeyAsync(authenticatedClient, "Introspection key");

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectRevokedApiKey_ReturnsInvalidAndRevoked()
        {
            // The realistic revocation flow: rotate a leaked key without touching the account.
            var authenticatedClient = await AuthHelper.CreateAuthenticatedClientAsync(
                factory,
                $"introspect-apikey-rotate-{Guid.NewGuid()}@example.com",
                Password);

            var (rawKey, keyId) = await CreateApiKeyAsync(authenticatedClient, "Key to rotate");

            var revokeResponse = await authenticatedClient.DeleteAsync($"/account/api-keys/{keyId}");
            revokeResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeTrue();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectExpiredApiKey_ReturnsInvalidAndExpired()
        {
            var authenticatedClient = await AuthHelper.CreateAuthenticatedClientAsync(
                factory,
                $"introspect-apikey-expired-{Guid.NewGuid()}@example.com",
                Password);

            var (rawKey, keyId) = await CreateApiKeyAsync(authenticatedClient, "Key that ages out");

            // The API refuses to mint a key that is already expired, so age the stored key instead —
            // the same state any key reaches once its expiry passes.
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
                var storedKey = await db.ApiKeys.FirstAsync(k => k.Id == keyId);
                storedKey.ExpiresAt = DateTime.UtcNow.AddMinutes(-5);
                await db.SaveChangesAsync();
            }

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isExpired").GetBoolean().Should().BeTrue();
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectRevokedCookieSession_ReturnsInvalidAndRevoked()
        {
            // Soft-deleting the account rotates the security stamp; with ValidationInterval = Zero the
            // very next introspection of the same forwarded cookie must report it revoked.
            var email = $"introspect-revoked-{Guid.NewGuid()}@example.com";
            var cookieHeader = await AuthHelper.CreateSessionCookieHeaderAsync(factory, email, Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", cookieHeader);

            var deleteResponse = await client.DeleteAsync("/account/profile");
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("cookie");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeTrue();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectNoCredential_ReturnsInvalidWithTypeNone()
        {
            var client = factory.CreateClient();

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
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

            var (rawKey, _) = await CreateApiKeyAsync(authenticatedClient, "Revocation test key");

            // Soft-delete the account while authenticated.
            var deleteResponse = await authenticatedClient.DeleteAsync("/account/profile");
            deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

            // Attempt introspection with the API key that belonged to the deleted account.
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", rawKey);

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeTrue();
        }

        [Fact]
        public async Task IntrospectValidCookie_IsNotDefeatedByAnUnrelatedAuthorizationHeader()
        {
            // A stale Authorization header travelling alongside a live session must not shadow the
            // cookie — account-service's own default policy accepts any of the three schemes, and
            // introspection has to answer the same way.
            var cookieHeader = await AuthHelper.CreateSessionCookieHeaderAsync(
                factory,
                $"introspect-mixed-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", cookieHeader);
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer not-a-real-token");

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            payload.GetProperty("credentialType").GetString().Should().Be("cookie");
            payload.GetProperty("accountId").GetString().Should().NotBeNullOrWhiteSpace();
        }

        [Fact]
        public async Task IntrospectMalformedCookie_ReturnsDefinitiveNegative()
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", $"{IdentityCookieName}=not-a-real-ticket");

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("cookie");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectMalformedBearerToken_ReturnsDefinitiveNegative()
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer %%%not-base64%%%");

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("bearer");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectMalformedApiKey_ReturnsDefinitiveNegative()
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", "rep_%%%not-a-key%%%");

            var response = await client.PostAsync(EndpointPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var payload = await ReadPayloadAsync(response);
            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.GetProperty("credentialType").GetString().Should().Be("apiKey");
            payload.GetProperty("accountId").ValueKind.Should().Be(JsonValueKind.Null);
            payload.GetProperty("isRevoked").GetBoolean().Should().BeFalse();
            payload.GetProperty("isExpired").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task IntrospectionResponse_CarriesIdentityAndValidityOnly()
        {
            // Pins the whole property set, so the "no PII, no role, no user_type" requirement
            // (PRD §11.2) fails a test rather than a review if a field is ever added.
            var cookieHeader = await AuthHelper.CreateSessionCookieHeaderAsync(
                factory,
                $"introspect-shape-{Guid.NewGuid()}@example.com",
                Password);

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", cookieHeader);

            var payload = await ReadPayloadAsync(await client.PostAsync(EndpointPath, content: null));

            payload.EnumerateObject().Select(property => property.Name)
                .Should().BeEquivalentTo("isValid", "credentialType", "accountId", "isRevoked", "isExpired");
        }

        [Fact]
        public async Task IntrospectionEndpoint_IsNotAdvertisedInTheOpenApiDocument()
        {
            // account-service-routes.json aggregates this document into the gateway's Swagger UI,
            // which is served through the public api-gateway Ingress. Being unreachable is not the
            // same as being unadvertised, and the AC requires both.
            var client = factory.CreateClient();

            var response = await client.GetAsync("/openapi/v1.json");
            response.StatusCode.Should().Be(HttpStatusCode.OK);

            var document = await response.Content.ReadAsStringAsync();
            document.Should().NotContain(EndpointPath);
        }

        private static async Task<JsonElement> ReadPayloadAsync(HttpResponseMessage response) =>
            JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        private static async Task<(string RawKey, string KeyId)> CreateApiKeyAsync(HttpClient client, string name)
        {
            var createResponse = await client.PostAsJsonAsync("/account/api-keys", new { name });
            createResponse.StatusCode.Should().Be(HttpStatusCode.Created);

            var created = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync()).RootElement;
            var rawKey = created.GetProperty("key").GetString();
            var keyId = created.GetProperty("id").GetString();

            rawKey.Should().NotBeNullOrWhiteSpace();
            keyId.Should().NotBeNullOrWhiteSpace();

            return (rawKey!, keyId!);
        }
    }
}
