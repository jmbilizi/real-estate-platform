// <copyright file="AccountDbContextTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
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
            var user = new IdentityUser
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
    }
}
