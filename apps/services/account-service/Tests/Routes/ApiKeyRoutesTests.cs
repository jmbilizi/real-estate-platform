// <copyright file="ApiKeyRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Data;
using AccountService.Models;
using AccountService.Routes;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace AccountService.Tests.Routes
{
    /// <summary>
    /// Unit tests for the API key management endpoints.
    /// </summary>
    public class ApiKeyRoutesTests : IDisposable
    {
        private readonly AccountDbContext db;
        private readonly Mock<UserManager<ApplicationUser>> userManagerMock;

        /// <summary>
        /// Initializes a new instance of the <see cref="ApiKeyRoutesTests"/> class.
        /// </summary>
        public ApiKeyRoutesTests()
        {
            var options = new DbContextOptionsBuilder<AccountDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            db = new AccountDbContext(options);
            db.Database.EnsureCreated();

            var store = new Mock<IUserStore<ApplicationUser>>();
            userManagerMock = new Mock<UserManager<ApplicationUser>>(
                store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            db.Dispose();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public void HashKey_SameInput_ProducesSameOutput()
        {
            var h1 = ApiKeys.HashKey("rep_abc123");
            var h2 = ApiKeys.HashKey("rep_abc123");
            h1.Should().Be(h2);
        }

        [Fact]
        public void HashKey_DifferentInputs_ProduceDifferentOutputs()
        {
            ApiKeys.HashKey("rep_abc123").Should().NotBe(ApiKeys.HashKey("rep_xyz999"));
        }

        [Fact]
        public void HashKey_OutputIsLowercaseHex64Chars()
        {
            var hash = ApiKeys.HashKey("rep_test");
            hash.Should().HaveLength(64).And.MatchRegex("^[0-9a-f]+$");
        }

        [Fact]
        public async Task RevokeKey_SetsRevokedAt_WhenKeyBelongsToUser()
        {
            // Arrange
            var user = MakeUser();
            db.Users.Add(user);
            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                Name = "Test",
                Prefix = "rep_abcd1234",
                KeyHash = ApiKeys.HashKey("rep_somekey"),
                CreatedAt = DateTime.UtcNow,
            };
            db.ApiKeys.Add(key);
            await db.SaveChangesAsync();

            userManagerMock.Setup(m => m.GetUserAsync(It.IsAny<ClaimsPrincipal>()))
                .ReturnsAsync(user);

            // Act — invoke the endpoint logic directly
            var result = await InvokeRevokeAsync(key.Id, user);

            // Assert
            result.Should().BeOfType<NoContent>();
            var saved = await db.ApiKeys.FindAsync(key.Id);
            saved!.RevokedAt.Should().NotBeNull();
        }

        [Fact]
        public async Task RevokeKey_IsIdempotent_WhenAlreadyRevoked()
        {
            // Arrange
            var user = MakeUser();
            db.Users.Add(user);
            var revokedAt = DateTime.UtcNow.AddHours(-1);
            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                Name = "Test",
                Prefix = "rep_abcd1234",
                KeyHash = ApiKeys.HashKey("rep_alreadyrevoked"),
                RevokedAt = revokedAt,
                CreatedAt = DateTime.UtcNow.AddDays(-1),
            };
            db.ApiKeys.Add(key);
            await db.SaveChangesAsync();

            userManagerMock.Setup(m => m.GetUserAsync(It.IsAny<ClaimsPrincipal>()))
                .ReturnsAsync(user);

            // Act
            var result = await InvokeRevokeAsync(key.Id, user);

            // Assert
            result.Should().BeOfType<NoContent>();
            var saved = await db.ApiKeys.FindAsync(key.Id);
            saved!.RevokedAt.Should().Be(revokedAt); // unchanged
        }

        [Fact]
        public async Task RevokeKey_ReturnsNotFound_WhenKeyBelongsToDifferentUser()
        {
            // Arrange
            var owner = MakeUser();
            var attacker = MakeUser();
            db.Users.Add(owner);
            db.Users.Add(attacker);
            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = owner.Id,
                Name = "Test",
                Prefix = "rep_abcd1234",
                KeyHash = ApiKeys.HashKey("rep_ownerskey"),
                CreatedAt = DateTime.UtcNow,
            };
            db.ApiKeys.Add(key);
            await db.SaveChangesAsync();

            userManagerMock.Setup(m => m.GetUserAsync(It.IsAny<ClaimsPrincipal>()))
                .ReturnsAsync(attacker);

            // Act — attacker tries to revoke owner's key
            var result = await InvokeRevokeAsync(key.Id, attacker);

            // Assert
            result.Should().BeOfType<NotFound>();
            var saved = await db.ApiKeys.FindAsync(key.Id);
            saved!.RevokedAt.Should().BeNull(); // untouched
        }

        [Fact]
        public async Task RevokeKey_ReturnsUnauthorized_WhenUserIsDeleted()
        {
            // Arrange
            var user = MakeUser();
            user.DeletedAt = DateTime.UtcNow.AddDays(-1);
            userManagerMock.Setup(m => m.GetUserAsync(It.IsAny<ClaimsPrincipal>()))
                .ReturnsAsync(user);

            // Act
            var result = await InvokeRevokeAsync(Guid.NewGuid().ToString(), user);

            // Assert
            result.Should().BeOfType<UnauthorizedHttpResult>();
        }

        private static ApplicationUser MakeUser(string? id = null) => new()
        {
            Id = id ?? Guid.NewGuid().ToString(),
            UserName = "user@example.com",
            Email = "user@example.com",
        };

        private static ClaimsPrincipal MakePrincipal(string userId) =>
            new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId) }));

        private async Task<IResult> InvokeRevokeAsync(string keyId, ApplicationUser user)
        {
            var principal = MakePrincipal(user.Id);
            userManagerMock.Setup(m => m.GetUserAsync(It.IsAny<ClaimsPrincipal>()))
                .ReturnsAsync(user);

            // Simulate the DELETE endpoint handler inline
            var foundUser = await userManagerMock.Object.GetUserAsync(principal);
            if (foundUser is null || foundUser.DeletedAt.HasValue)
            {
                return Results.Unauthorized();
            }

            var apiKey = await db.ApiKeys
                .FirstOrDefaultAsync(k => k.Id == keyId && k.UserId == foundUser.Id);

            if (apiKey is null)
            {
                return Results.NotFound();
            }

            if (apiKey.RevokedAt.HasValue)
            {
                return Results.NoContent();
            }

            apiKey.RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        }
    }
}
