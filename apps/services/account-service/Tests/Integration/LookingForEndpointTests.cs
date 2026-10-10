// <copyright file="LookingForEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>Integration tests for the "What I'm looking for" endpoints (#768).</summary>
    public class LookingForEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#Abcd";

        [Fact]
        public async Task AllRoutes_RefuseAnonymousCallers()
        {
            var client = factory.CreateClient();
            (await client.GetAsync("/account/looking-for")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", Body())).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);
            (await client.DeleteAsync($"/account/looking-for/{Guid.NewGuid()}")).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);
        }

        [Fact]
        public async Task Get_ReturnsEmptyList_ForNewAccount()
        {
            var client = await NewClientAsync("lf-empty");
            var body = await (await client.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("items").GetArrayLength().Should().Be(0);
            body.GetProperty("max").GetInt32().Should().Be(5);
        }

        [Fact]
        public async Task Put_Creates_ThenReplaces_AndGetReturnsIt()
        {
            var client = await NewClientAsync("lf-roundtrip");
            var id = Guid.NewGuid();

            var created = await client.PutAsJsonAsync($"/account/looking-for/{id}", Body(Future(10)));
            created.StatusCode.Should().Be(HttpStatusCode.Created);

            var replaced = await client.PutAsJsonAsync($"/account/looking-for/{id}", Body(null, "rent"));
            replaced.StatusCode.Should().Be(HttpStatusCode.OK);

            var list = await (await client.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            var items = list.GetProperty("items");
            items.GetArrayLength().Should().Be(1);
            var item = items[0];
            item.GetProperty("intent").GetString().Should().Be("rent");
            item.GetProperty("places")[0].GetProperty("city").GetString().Should().Be("Alexandria");
            item.GetProperty("homeTypes").GetArrayLength().Should().Be(2);
            item.GetProperty("whenStart").ValueKind.Should().Be(JsonValueKind.Null);
        }

        [Fact]
        public async Task Put_AcceptsADateRange()
        {
            var client = await NewClientAsync("lf-range");
            var response = await client.PutAsJsonAsync(
                $"/account/looking-for/{Guid.NewGuid()}",
                new
                {
                    intent = "buy",
                    places = new[] { new { kind = "zip", zip = "22314", city = "Alexandria", state = "VA" } },
                    whenStart = Future(30),
                    whenEnd = Future(90),
                });
            response.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        [Theory]
        [InlineData("intent")]
        [InlineData("places")]
        [InlineData("badPlace")]
        [InlineData("priceOrder")]
        [InlineData("beds")]
        [InlineData("homeType")]
        [InlineData("pastDate")]
        [InlineData("endBeforeStart")]
        [InlineData("endWithoutStart")]
        public async Task Put_Returns400_ForABadValue(string which)
        {
            var client = await NewClientAsync("lf-bad-" + which);
            var city = new[] { new { kind = "city", city = "Alexandria", state = "VA" } };
            object body = which switch
            {
                "intent" => new { intent = "sell", places = city },
                "places" => new { intent = "buy", places = Array.Empty<object>() },
                "badPlace" => new { intent = "buy", places = new[] { new { kind = "city", city = "Alexandria", state = "Virginia" } } },
                "priceOrder" => new { intent = "buy", places = city, priceMin = 900000, priceMax = 100000 },
                "beds" => new { intent = "buy", places = city, bedsMin = -1 },
                "homeType" => new { intent = "buy", places = city, homeTypes = new[] { "Castle" } },
                "pastDate" => new { intent = "buy", places = city, whenStart = Future(-10) },
                "endBeforeStart" => new { intent = "buy", places = city, whenStart = Future(20), whenEnd = Future(10) },
                _ => new { intent = "buy", places = city, whenEnd = Future(10) },
            };

            var response = await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Put_DropsAFreeTextField()
        {
            // The body has no free-text field. Unknown properties are dropped, never stored.
            var client = await NewClientAsync("lf-extra");
            var id = Guid.NewGuid();
            var response = await client.PutAsJsonAsync($"/account/looking-for/{id}", new
            {
                intent = "buy",
                places = new[] { new { kind = "city", city = "Alexandria", state = "VA" } },
                notes = "family friendly",
            });
            response.StatusCode.Should().Be(HttpStatusCode.Created);
            (await response.Content.ReadAsStringAsync()).Should().NotContain("family");
        }

        [Fact]
        public async Task Put_Returns409_AtTheLimitOfFive_ButStillReplacesAnExistingOne()
        {
            var client = await NewClientAsync("lf-limit");
            var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToList();
            foreach (var id in ids)
            {
                (await client.PutAsJsonAsync($"/account/looking-for/{id}", Body())).StatusCode
                    .Should().Be(HttpStatusCode.Created);
            }

            (await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", Body())).StatusCode
                .Should().Be(HttpStatusCode.Conflict);
            (await client.PutAsJsonAsync($"/account/looking-for/{ids[0]}", Body(null, "rent"))).StatusCode
                .Should().Be(HttpStatusCode.OK);

            // Removing one frees a slot.
            (await client.DeleteAsync($"/account/looking-for/{ids[1]}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", Body())).StatusCode
                .Should().Be(HttpStatusCode.Created);
        }

        [Fact]
        public async Task Delete_IsIdempotent()
        {
            var client = await NewClientAsync("lf-delete");
            var id = Guid.NewGuid();
            await client.PutAsJsonAsync($"/account/looking-for/{id}", Body());

            (await client.DeleteAsync($"/account/looking-for/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await client.DeleteAsync($"/account/looking-for/{id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
            var list = await (await client.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            list.GetProperty("items").GetArrayLength().Should().Be(0);
        }

        [Fact]
        public async Task Accounts_AreIsolated_EvenWhenTheyShareAnId()
        {
            var first = await NewClientAsync("lf-iso-a");
            var second = await NewClientAsync("lf-iso-b");
            var id = Guid.NewGuid();

            await first.PutAsJsonAsync($"/account/looking-for/{id}", Body());
            (await second.PutAsJsonAsync($"/account/looking-for/{id}", Body(null, "rent"))).StatusCode
                .Should().Be(HttpStatusCode.Created);

            var a = await (await first.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            a.GetProperty("items")[0].GetProperty("intent").GetString().Should().Be("buy");

            // A delete from one account leaves the other account's row.
            await second.DeleteAsync($"/account/looking-for/{id}");
            var again = await (await first.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            again.GetProperty("items").GetArrayLength().Should().Be(1);
        }

        [Fact]
        public async Task AMultiRoleAccount_HoldsABuyAndARentPreference()
        {
            var email = $"lf-multi-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);
            using (var scope = factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var user = await users.FindByEmailAsync(email);
                (await users.AddToRoleAsync(user!, Roles.Agent)).Succeeded.Should().BeTrue();
            }

            await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", Body());
            await client.PutAsJsonAsync($"/account/looking-for/{Guid.NewGuid()}", Body(null, "rent"));

            var list = await (await client.GetAsync("/account/looking-for")).Content.ReadFromJsonAsync<JsonElement>();
            list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("intent").GetString())
                .Should().BeEquivalentTo(["buy", "rent"]);
        }

        private static object Body(object? when = null, string intent = "buy") => new
        {
            intent,
            places = new[] { new { kind = "city", city = "Alexandria", state = "VA" } },
            priceMin = 400000,
            priceMax = 900000,
            bedsMin = 2,
            bathsMin = 1,
            homeTypes = new[] { "Condo", "Townhome" },
            whenStart = when,
        };

        private static string Future(int days) =>
            DateTime.UtcNow.AddDays(days).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

        private Task<HttpClient> NewClientAsync(string prefix) =>
            AuthHelper.CreateAuthenticatedClientAsync(factory, $"{prefix}-{Guid.NewGuid()}@example.com", Password);
    }
}
