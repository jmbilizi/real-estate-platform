// <copyright file="AccountDbContextTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AccountService.Tests.Data
{
    /// <summary>
    /// Unit tests for <see cref="AccountDbContext"/>.
    /// </summary>
    public class AccountDbContextTests : IDisposable
    {
        private readonly AccountDbContext context;

        /// <summary>
        /// Initializes a new instance of the <see cref="AccountDbContextTests"/> class.
        /// </summary>
        public AccountDbContextTests()
        {
            var options = new DbContextOptionsBuilder<AccountDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;

            context = new AccountDbContext(options);
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            context.Dispose();
            GC.SuppressFinalize(this);
        }

        [Fact]
        public async Task EnsureCreated_ShouldCreateIdentitySchema()
        {
            // Act
            var created = await context.Database.EnsureCreatedAsync();

            // Assert
            created.Should().BeTrue();
        }

        [Fact]
        public async Task Users_ShouldBeEmptyOnFreshDatabase()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();

            // Act
            var users = await context.Users.ToListAsync();

            // Assert
            users.Should().BeEmpty();
        }

        [Fact]
        public async Task Users_ShouldPersistAddedUser()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();
            var user = new ApplicationUser
            {
                Id = Guid.NewGuid().ToString(),
                UserName = "testuser@example.com",
                Email = "testuser@example.com",
                NormalizedUserName = "TESTUSER@EXAMPLE.COM",
                NormalizedEmail = "TESTUSER@EXAMPLE.COM",
            };

            // Act
            await context.Users.AddAsync(user);
            await context.SaveChangesAsync();

            // Assert
            var saved = await context.Users.FindAsync(user.Id);
            saved.Should().NotBeNull();
            saved!.Email.Should().Be("testuser@example.com");
        }

        [Fact]
        public async Task Roles_ShouldBeEmptyOnFreshDatabase()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();

            // Act
            var roles = await context.Roles.ToListAsync();

            // Assert
            roles.Should().BeEmpty();
        }

        [Fact]
        public async Task ApiKeys_ShouldPersistAndQueryByUserId()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();
            var userId = Guid.NewGuid().ToString();
            var user = new ApplicationUser { Id = userId, UserName = "u@x.com", Email = "u@x.com" };
            context.Users.Add(user);

            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                Name = "My Key",
                Prefix = "rep_abcd1234",
                KeyHash = "deadbeef",
                CreatedAt = DateTime.UtcNow,
            };
            context.ApiKeys.Add(key);
            await context.SaveChangesAsync();

            // Act
            var found = await context.ApiKeys.Where(k => k.UserId == userId).ToListAsync();

            // Assert
            found.Should().ContainSingle();
            found[0].Name.Should().Be("My Key");
            found[0].Prefix.Should().Be("rep_abcd1234");
        }

        [Fact]
        public async Task ApiKeys_RevokedAt_NullByDefault()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();
            var userId = Guid.NewGuid().ToString();
            context.Users.Add(new ApplicationUser { Id = userId, UserName = "u@x.com", Email = "u@x.com" });
            var key = new ApiKey
            {
                Id = Guid.NewGuid().ToString(),
                UserId = userId,
                Name = "Key",
                Prefix = "rep_abcd1234",
                KeyHash = "abc123",
                CreatedAt = DateTime.UtcNow,
            };
            context.ApiKeys.Add(key);
            await context.SaveChangesAsync();

            // Act
            var saved = await context.ApiKeys.FindAsync(key.Id);

            // Assert
            saved!.RevokedAt.Should().BeNull();
            saved.LastUsedAt.Should().BeNull();
            saved.ExpiresAt.Should().BeNull();
        }

        [Fact]
        public async Task AccountStatuses_ShouldPersistLookupRow()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();
            context.AccountStatuses.Add(new AccountStatus { Code = "Active", Label = "Active" });
            await context.SaveChangesAsync();

            // Act
            var found = await context.AccountStatuses.FirstOrDefaultAsync(s => s.Code == "Active");

            // Assert
            found.Should().NotBeNull();
            found!.Label.Should().Be("Active");
        }

        [Fact]
        public async Task Locales_ShouldPersistLookupRow()
        {
            // Arrange
            await context.Database.EnsureCreatedAsync();
            context.Locales.Add(new Locale { Code = "en-ZA", Name = "English (South Africa)" });
            await context.SaveChangesAsync();

            // Act
            var found = await context.Locales.FirstOrDefaultAsync(l => l.Code == "en-ZA");

            // Assert
            found.Should().NotBeNull();
            found!.Name.Should().Be("English (South Africa)");
        }
    }
}
