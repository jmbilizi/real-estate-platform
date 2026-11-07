// <copyright file="RecentlyViewedEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Data;
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
    /// <summary>Integration tests for the recently viewed listing ids (#365).</summary>
    public class RecentlyViewedEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#Abcd";
        private const string Path = "/account/recently-viewed";

        [Fact]
        public async Task Routes_RefuseAnonymousCallers()
        {
            var client = factory.CreateClient();

            (await client.GetAsync(Path)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await client.PostAsJsonAsync(Path, new { listingId = "abc" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Get_ReturnsAnEmptyList_ForAnAccountWithNoViews()
        {
            var client = await NewClientAsync("rv-empty");

            (await ReadIdsAsync(client)).Should().BeEmpty();
        }

        [Fact]
        public async Task Post_StoresTheId_AndGetReturnsNewestFirst()
        {
            var client = await NewClientAsync("rv-order");

            await ViewAsync(client, "A1");
            await Task.Delay(30);
            await ViewAsync(client, "B2");
            await Task.Delay(30);
            await ViewAsync(client, "C3");

            (await ReadIdsAsync(client)).Should().Equal("C3", "B2", "A1");
        }

        [Fact]
        public async Task Post_ReviewMovesTheIdToTheFront_WithoutDuplicating()
        {
            var client = await NewClientAsync("rv-reorder");

            await ViewAsync(client, "A1");
            await Task.Delay(30);
            await ViewAsync(client, "B2");
            await Task.Delay(30);
            await ViewAsync(client, "A1");

            (await ReadIdsAsync(client)).Should().Equal("A1", "B2");
        }

        [Fact]
        public async Task Post_KeepsOnlyTheTwentyMostRecent()
        {
            var client = await NewClientAsync("rv-cap");

            for (var i = 1; i <= 23; i++)
            {
                await ViewAsync(client, $"L{i}");
                await Task.Delay(20);
            }

            var ids = await ReadIdsAsync(client);
            ids.Should().HaveCount(20);
            ids.First().Should().Be("L23");
            ids.Last().Should().Be("L4");
        }

        [Fact]
        public async Task Lists_AreSeparatePerAccount()
        {
            var first = await NewClientAsync("rv-own-a");
            var second = await NewClientAsync("rv-own-b");

            await ViewAsync(first, "ONLY-A");

            (await ReadIdsAsync(second)).Should().BeEmpty();
            (await ReadIdsAsync(first)).Should().Equal("ONLY-A");
        }

        [Theory]
        [InlineData("")]
        [InlineData(" ")]
        [InlineData("has space")]
        [InlineData("<script>")]
        [InlineData("abc\n")]
        public async Task Post_RejectsAnInvalidId(string listingId)
        {
            var client = await NewClientAsync("rv-bad");

            (await client.PostAsJsonAsync(Path, new { listingId })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await ReadIdsAsync(client)).Should().BeEmpty();
        }

        [Fact]
        public async Task Post_RejectsAMissingOrTooLongId()
        {
            var client = await NewClientAsync("rv-long");

            (await client.PostAsJsonAsync(Path, new { })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync(Path, new { listingId = new string('a', 65) })).StatusCode
                .Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Rows_HoldOnlyTheIdAndATime()
        {
            var (client, id) = await NewAccountAsync("rv-shape");
            await ViewAsync(client, "SHAPE-1");

            using var scope = factory.Services.CreateScope();
            var rows = await scope.ServiceProvider.GetRequiredService<AccountDbContext>().RecentlyViewedListings
                .Where(r => r.UserId == id)
                .ToListAsync();
            var row = rows.Should().ContainSingle().Subject;
            row.ListingId.Should().Be("SHAPE-1");
            row.ViewedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(1));
            typeof(RecentlyViewedListing).GetProperties().Select(p => p.Name)
                .Should().BeEquivalentTo("UserId", "ListingId", "ViewedAt");
        }

        private static async Task ViewAsync(HttpClient client, string listingId)
        {
            var response = await client.PostAsJsonAsync(Path, new { listingId });
            response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        private static async Task<List<string>> ReadIdsAsync(HttpClient client)
        {
            var response = await client.GetAsync(Path);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("listingIds").EnumerateArray().Select(e => e.GetString()!).ToList();
        }

        private async Task<HttpClient> NewClientAsync(string prefix) => (await NewAccountAsync(prefix)).Client;

        private async Task<(HttpClient Client, string Id)> NewAccountAsync(string prefix)
        {
            var email = $"{prefix}-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            using var scope = factory.Services.CreateScope();
            var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email);
            return (client, user!.Id);
        }
    }
}
