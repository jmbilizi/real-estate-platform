// <copyright file="UserAppClaimsTransformationTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>
using System.Security.Claims;
using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for <see cref="UserAppClaimsTransformation"/>.
    /// Exercises claim enrichment, short-circuit behaviour, and principal isolation.
    /// </summary>
    public class UserAppClaimsTransformationTests : IDisposable
    {
        private readonly AccountDbContext db;

        /// <summary>
        /// Initializes a new instance of the <see cref="UserAppClaimsTransformationTests"/> class.
        /// </summary>
        public UserAppClaimsTransformationTests()
        {
            var options = new DbContextOptionsBuilder<AccountDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            db = new AccountDbContext(options);
            db.Database.EnsureCreated();
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            db.Dispose();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public async Task TransformAsync_ReturnsUnchanged_WhenPrincipalHasNoNameIdentifierClaim()
        {
            // Arrange: anonymous principal with no NameIdentifier
            var principal = new ClaimsPrincipal(new ClaimsIdentity());
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert: same reference returned — no DB hit, no enrichment
            result.Should().BeSameAs(principal);
        }

        [Fact]
        public async Task TransformAsync_ReturnsUnchanged_WhenUserHasNoApps()
        {
            // Arrange: authenticated user with no UserApp rows
            var principal = MakePrincipal("user-no-apps");
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert
            result.Should().BeSameAs(principal);
            result.HasClaim(c => c.Type == "app_access").Should().BeFalse();
        }

        [Fact]
        public async Task TransformAsync_ReturnsUnchanged_WhenAppAccessClaimsAlreadyPresent()
        {
            // Arrange: principal already carrying app_access (re-entrant call scenario)
            var userId = "user-already-enriched";
            await SeedUserAppAsync(userId, "cribstop");

            var identity = new ClaimsIdentity(
                new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, userId),
                    new Claim("app_access", "cribstop"),
                },
                "test");
            var principal = new ClaimsPrincipal(identity);
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert: short-circuit — same reference, no second DB query
            result.Should().BeSameAs(principal);
        }

        [Fact]
        public async Task TransformAsync_AddsAppAccessClaims_ForEachUserApp()
        {
            // Arrange
            var userId = "user-two-apps";
            await SeedUserAppAsync(userId, "cribstop");
            await SeedUserAppAsync(userId, "admin-portal");

            var principal = MakePrincipal(userId);
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert: one claim per app
            var appClaims = result.FindAll("app_access").Select(c => c.Value).ToList();
            appClaims.Should().BeEquivalentTo("cribstop", "admin-portal");
        }

        [Fact]
        public async Task TransformAsync_PreservesOriginalClaims_WhenAddingAppAccess()
        {
            // Arrange
            var userId = "user-preserved-claims";
            await SeedUserAppAsync(userId, "cribstop");

            var principal = MakePrincipal(userId);
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert: NameIdentifier still present alongside new app_access claim
            result.FindFirstValue(ClaimTypes.NameIdentifier).Should().Be(userId);
            result.HasClaim("app_access", "cribstop").Should().BeTrue();
        }

        [Fact]
        public async Task TransformAsync_DoesNotMutateOriginalPrincipal_WhenAddingClaims()
        {
            // Arrange
            var userId = "user-clone-isolation";
            await SeedUserAppAsync(userId, "cribstop");

            var principal = MakePrincipal(userId);
            var sut = new UserAppClaimsTransformation(db);

            // Act
            var result = await sut.TransformAsync(principal);

            // Assert: result is a new object and original is untouched
            result.Should().NotBeSameAs(principal);
            principal.HasClaim("app_access", "cribstop").Should().BeFalse();
        }

        // ── Helpers ──────────────────────────────────────────────────────────────
        private static ClaimsPrincipal MakePrincipal(string userId) =>
            new(new ClaimsIdentity(
                new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
                "test"));

        private async Task SeedUserAppAsync(string userId, string appId)
        {
            db.UserApps.Add(new UserApp
            {
                UserId = userId,
                AppId = appId,
                FirstSeenAt = DateTime.UtcNow,
                LastSeenAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }
}
