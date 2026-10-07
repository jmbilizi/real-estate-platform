// <copyright file="ContactLookupEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AccountService.Tests.Integration
{
    /// <summary>Integration tests for <c>POST /internal/account/contacts</c> (#689).</summary>
    public class ContactLookupEndpointTests(AccountServiceFactory factory) : IClassFixture<AccountServiceFactory>
    {
        private const string Path = "/internal/account/contacts";
        private const string Password = "Test1234!@#Abcd";
        private static readonly string[] BadIds = new[] { "not-a-guid" };

        [Fact]
        public async Task KnownIds_ReturnContactFacts()
        {
            var email = $"contacts-{Guid.NewGuid():N}@example.com";
            await AuthHelper.SeedUserAsync(factory, email, Password);
            var id = await IdOfAsync(email, displayName: "Casey Buyer");

            var response = await factory.CreateClient().PostAsJsonAsync(Path, new { accountIds = new[] { id } });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var contacts = await ReadContactsAsync(response);
            contacts.Should().HaveCount(1);
            contacts[0].GetProperty("accountId").GetGuid().Should().Be(id);
            contacts[0].GetProperty("email").GetString().Should().Be(email);
            contacts[0].GetProperty("displayName").GetString().Should().Be("Casey Buyer");
            contacts[0].GetProperty("emailConfirmed").GetBoolean().Should().BeTrue();
        }

        [Fact]
        public async Task UnknownIds_AreOmittedWithoutError()
        {
            var response = await factory.CreateClient().PostAsJsonAsync(Path, new { accountIds = new[] { Guid.NewGuid() } });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadContactsAsync(response)).Should().BeEmpty();
        }

        [Fact]
        public async Task MixedAndSoftDeletedIds_ReturnOnlyLiveAccounts()
        {
            var live = $"contacts-live-{Guid.NewGuid():N}@example.com";
            var gone = $"contacts-gone-{Guid.NewGuid():N}@example.com";
            await AuthHelper.SeedUserAsync(factory, live, Password);
            await AuthHelper.SeedUserAsync(factory, gone, Password);
            var liveId = await IdOfAsync(live);
            var goneId = await IdOfAsync(gone, deleted: true);

            var response = await factory.CreateClient().PostAsJsonAsync(
                Path,
                new { accountIds = new[] { liveId, goneId, Guid.NewGuid(), liveId } });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var contacts = await ReadContactsAsync(response);
            contacts.Should().HaveCount(1);
            contacts[0].GetProperty("accountId").GetGuid().Should().Be(liveId);
        }

        [Fact]
        public async Task OverLimitBatch_Returns400()
        {
            var ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray();

            var response = await factory.CreateClient().PostAsJsonAsync(Path, new { accountIds = ids });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task MaxBatch_Returns200()
        {
            var ids = Enumerable.Range(0, 100).Select(_ => Guid.NewGuid()).ToArray();

            var response = await factory.CreateClient().PostAsJsonAsync(Path, new { accountIds = ids });

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task EmptyOrMissingBatch_Returns400()
        {
            var client = factory.CreateClient();

            (await client.PostAsJsonAsync(Path, new { accountIds = Array.Empty<Guid>() }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(Path, new { }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(Path, new { accountIds = BadIds }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        private static async Task<List<JsonElement>> ReadContactsAsync(HttpResponseMessage response)
        {
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("contacts").EnumerateArray().Select(e => e.Clone()).ToList();
        }

        private async Task<Guid> IdOfAsync(string email, string? displayName = null, bool deleted = false)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            var user = db.Users.Single(u => u.Email == email);
            user.DisplayName = displayName;
            if (deleted)
            {
                user.DeletedAt = DateTime.UtcNow;
            }

            await db.SaveChangesAsync();
            return Guid.Parse(user.Id);
        }
    }
}
