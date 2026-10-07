// <copyright file="StaffRolesEndpointTests.cs" company="PlaceholderCompany">
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

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the Agent role, role-grant auditing and the roles carried by introspection (#628).
    /// </summary>
    public class StaffRolesEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private const string Password = "Test1234!@#";
        private const string IntrospectPath = "/internal/account/introspect";

        [Fact]
        public async Task Introspect_ForBuyerOnlyAccount_ReturnsUserRoleEmailAndConfirmedFlag()
        {
            var email = $"staff-buyer-{Guid.NewGuid()}@example.com";
            var client = await AuthHelper.CreateAuthenticatedClientAsync(factory, email, Password);

            var payload = await IntrospectAsync(client);

            payload.GetProperty("isValid").GetBoolean().Should().BeTrue();
            RolesOf(payload).Should().BeEquivalentTo(new[] { Roles.User });
            payload.GetProperty("email").GetString().Should().Be(email);
            payload.GetProperty("emailConfirmed").GetBoolean().Should().BeFalse();
        }

        [Fact]
        public async Task Introspect_ForInvalidCredential_OmitsRolesEmailAndConfirmedFlag()
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", "not-a-real-key");

            var payload = await IntrospectAsync(client);

            payload.GetProperty("isValid").GetBoolean().Should().BeFalse();
            payload.TryGetProperty("roles", out _).Should().BeFalse();
            payload.TryGetProperty("email", out _).Should().BeFalse();
            payload.TryGetProperty("emailConfirmed", out _).Should().BeFalse();
        }

        [Fact]
        public async Task SuperAdmin_AssignsAgentAndModerator_IntrospectionListsBothAndAuditsEach()
        {
            var (admin, adminId) = await CreateRoleHolderAsync(Roles.SuperAdmin);
            var (target, targetId) = await CreateRoleHolderAsync();

            (await admin.PostAsJsonAsync($"/account/{targetId}/roles", new { role = Roles.Agent }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await admin.PostAsJsonAsync($"/account/{targetId}/roles", new { role = Roles.Moderator }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);

            // Introspection reads the stored roles on every call, so the existing session sees the grants.
            var payload = await IntrospectAsync(target);
            RolesOf(payload).Should().BeEquivalentTo(new[] { Roles.User, Roles.Agent, Roles.Moderator });

            var audits = await AuditsForAsync(targetId);
            audits.Should().Contain(a => a.Role == Roles.Agent && a.Action == RoleGrantAudit.Granted && a.GrantorUserId == adminId);
            audits.Should().Contain(a => a.Role == Roles.Moderator && a.Action == RoleGrantAudit.Granted && a.GrantorUserId == adminId);
            audits.Should().OnlyContain(a => a.OccurredAt > DateTime.UtcNow.AddMinutes(-5));
        }

        [Fact]
        public async Task Admin_CanAssignAndRemoveAgent_AndRemovalIsAudited()
        {
            var (admin, adminId) = await CreateRoleHolderAsync(Roles.Admin);
            var (_, targetId) = await CreateRoleHolderAsync();

            (await admin.PostAsJsonAsync($"/account/{targetId}/roles", new { role = Roles.Agent }))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await admin.DeleteAsync($"/account/{targetId}/roles/{Roles.Agent}"))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);

            var audits = await AuditsForAsync(targetId);
            audits.Should().Contain(a => a.Action == RoleGrantAudit.Granted && a.Role == Roles.Agent && a.GrantorUserId == adminId);
            audits.Should().Contain(a => a.Action == RoleGrantAudit.Removed && a.Role == Roles.Agent && a.GrantorUserId == adminId);
        }

        [Fact]
        public async Task Admin_CannotAssignAdmin_AndNothingIsAudited()
        {
            var (admin, _) = await CreateRoleHolderAsync(Roles.Admin);
            var (_, targetId) = await CreateRoleHolderAsync();

            (await admin.PostAsJsonAsync($"/account/{targetId}/roles", new { role = Roles.Admin }))
                .StatusCode.Should().Be(HttpStatusCode.Forbidden);

            (await AuditsForAsync(targetId)).Should().BeEmpty();
        }

        [Fact]
        public async Task Moderator_CannotAssignAgent()
        {
            var (moderator, _) = await CreateRoleHolderAsync(Roles.Moderator);
            var (_, targetId) = await CreateRoleHolderAsync();

            (await moderator.PostAsJsonAsync($"/account/{targetId}/roles", new { role = Roles.Agent }))
                .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        private static async Task<JsonElement> IntrospectAsync(HttpClient client)
        {
            var response = await client.PostAsync(IntrospectPath, content: null);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
        }

        private static string[] RolesOf(JsonElement payload) =>
            [.. payload.GetProperty("roles").EnumerateArray().Select(r => r.GetString()!)];

        private async Task<(HttpClient Client, string Id)> CreateRoleHolderAsync(params string[] roles)
        {
            var email = $"staff-{Guid.NewGuid()}@example.com";
            var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });
            (await client.PostAsJsonAsync("/account/register", new { email, password = Password }))
                .EnsureSuccessStatusCode();

            string id;
            using (var scope = factory.Services.CreateScope())
            {
                var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var user = (await userManager.FindByEmailAsync(email))!;
                id = user.Id;
                if (roles.Length > 0)
                {
                    (await userManager.AddToRolesAsync(user, roles)).Succeeded.Should().BeTrue();
                }
            }

            (await client.PostAsJsonAsync("/account/login?useCookies=true", new { email, password = Password }))
                .EnsureSuccessStatusCode();
            return (client, id);
        }

        private async Task<List<RoleGrantAudit>> AuditsForAsync(string granteeId)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
            return await db.RoleGrantAudits.Where(a => a.GranteeUserId == granteeId).ToListAsync().ConfigureAwait(false);
        }
    }
}
