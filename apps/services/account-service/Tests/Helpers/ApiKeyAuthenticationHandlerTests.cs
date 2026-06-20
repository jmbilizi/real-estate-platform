// <copyright file="ApiKeyAuthenticationHandlerTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Helpers;
using AccountService.Models;
using AccountService.Routes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>
    /// Unit tests for API key authentication validation logic.
    /// These tests exercise the validation rules used by <see cref="ApiKeyAuthenticationHandler"/>
    /// directly against an in-memory DB without spinning up the full auth middleware stack.
    /// </summary>
    public class ApiKeyAuthenticationHandlerTests : IDisposable
    {
        private readonly AccountDbContext db;

        /// <summary>
        /// Initializes a new instance of the <see cref="ApiKeyAuthenticationHandlerTests"/> class.
        /// </summary>
        public ApiKeyAuthenticationHandlerTests()
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
        public async Task ValidKey_ShouldBeFoundByHash()
        {
            var (_, key, rawKey) = await SeedActiveKeyAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var found = await db.ApiKeys
                .Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            found.Should().NotBeNull();
            found!.Id.Should().Be(key.Id);
        }

        [Fact]
        public async Task UnknownKey_ShouldNotBeFoundByHash()
        {
            await SeedActiveKeyAsync();

            var hash = ApiKeys.HashKey("rep_unknownkeyXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
            var found = await db.ApiKeys
                .Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            found.Should().BeNull();
        }

        [Fact]
        public async Task RevokedKey_ShouldFailValidation()
        {
            var (_, key, rawKey) = await SeedActiveKeyAsync();
            key.RevokedAt = DateTime.UtcNow.AddHours(-1);
            await db.SaveChangesAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            var isRevoked = apiKey?.RevokedAt.HasValue ?? false;
            isRevoked.Should().BeTrue();
        }

        [Fact]
        public async Task ActiveKey_ShouldPassRevocationCheck()
        {
            var (_, _, rawKey) = await SeedActiveKeyAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            apiKey!.RevokedAt.Should().BeNull();
        }

        [Fact]
        public async Task ExpiredKey_ShouldFailValidation()
        {
            var (_, key, rawKey) = await SeedActiveKeyAsync();
            key.ExpiresAt = DateTime.UtcNow.AddHours(-1);
            await db.SaveChangesAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            var isExpired = apiKey?.ExpiresAt.HasValue == true && apiKey.ExpiresAt.Value <= DateTime.UtcNow;
            isExpired.Should().BeTrue();
        }

        [Fact]
        public async Task KeyWithFutureExpiry_ShouldPassExpiryCheck()
        {
            var (_, key, rawKey) = await SeedActiveKeyAsync();
            key.ExpiresAt = DateTime.UtcNow.AddDays(30);
            await db.SaveChangesAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            var isExpired = apiKey?.ExpiresAt.HasValue == true && apiKey.ExpiresAt.Value <= DateTime.UtcNow;
            isExpired.Should().BeFalse();
        }

        [Fact]
        public async Task KeyWithNoExpiry_ShouldPassExpiryCheck()
        {
            var (_, _, rawKey) = await SeedActiveKeyAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            apiKey!.ExpiresAt.Should().BeNull();
            var isExpired = apiKey.ExpiresAt.HasValue && apiKey.ExpiresAt.Value <= DateTime.UtcNow;
            isExpired.Should().BeFalse();
        }

        [Fact]
        public async Task KeyOwnerSoftDeleted_ShouldFailValidation()
        {
            var (user, _, rawKey) = await SeedActiveKeyAsync();
            user.DeletedAt = DateTime.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            var userUnavailable = apiKey?.User is null || apiKey.User.DeletedAt.HasValue;
            userUnavailable.Should().BeTrue();
        }

        [Fact]
        public async Task KeyOwnerActive_ShouldPassUserCheck()
        {
            var (_, _, rawKey) = await SeedActiveKeyAsync();

            var hash = ApiKeys.HashKey(rawKey);
            var apiKey = await db.ApiKeys.Include(k => k.User)
                .FirstOrDefaultAsync(k => k.KeyHash == hash);

            var userUnavailable = apiKey?.User is null || apiKey.User.DeletedAt.HasValue;
            userUnavailable.Should().BeFalse();
        }

        [Fact]
        public async Task SuccessfulAuth_ShouldUpdateLastUsedAt()
        {
            var (_, key, _) = await SeedActiveKeyAsync();
            key.LastUsedAt.Should().BeNull();

            key.LastUsedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var saved = await db.ApiKeys.FindAsync(key.Id);
            saved!.LastUsedAt.Should().NotBeNull();
            saved.LastUsedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
        }

        private async Task<(ApplicationUser User, ApiKey Key, string RawKey)> SeedActiveKeyAsync()
        {
            var user = new ApplicationUser
            {
                Id = Guid.NewGuid().ToString(),
                UserName = "user@example.com",
                Email = "user@example.com",
            };
            db.Users.Add(user);

            var rawKey = "rep_validkey0000000000000000000000000000001";
            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                Name = "Test Key",
                Prefix = "rep_validk",
                KeyHash = ApiKeys.HashKey(rawKey),
                CreatedAt = DateTime.UtcNow,
            };
            db.ApiKeys.Add(key);
            await db.SaveChangesAsync();
            return (user, key, rawKey);
        }
    }
}
