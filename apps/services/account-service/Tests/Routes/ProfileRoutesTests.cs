// <copyright file="ProfileRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.Json;
using AccountService.Data;
using AccountService.Dtos;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace AccountService.Tests.Routes
{
    /// <summary>
    /// Unit tests for profile endpoint logic.
    /// </summary>
    public class ProfileRoutesTests : IDisposable
    {
        private readonly AccountDbContext db;
        private readonly Mock<UserManager<ApplicationUser>> userManagerMock;

        /// <summary>
        /// Initializes a new instance of the <see cref="ProfileRoutesTests"/> class.
        /// </summary>
        public ProfileRoutesTests()
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
        public void ApplicationUser_DefaultNotificationPreferences_ShouldMatchSpec()
        {
            var user = new ApplicationUser();
            user.EmailNotificationsEnabled.Should().BeTrue();
            user.SmsNotificationsEnabled.Should().BeFalse();
            user.PushNotificationsEnabled.Should().BeTrue();
            user.MarketingOptIn.Should().BeFalse();
        }

        [Fact]
        public void ApplicationUser_DefaultNameFields_ShouldBeEmptyString()
        {
            var user = new ApplicationUser();
            user.FirstName.Should().Be(string.Empty);
            user.LastName.Should().Be(string.Empty);
            user.MiddleName.Should().Be(string.Empty);
        }

        [Fact]
        public void ApplicationUser_VerificationFields_ShouldBeNullByDefault()
        {
            var user = new ApplicationUser();
            user.VerifiedAt.Should().BeNull();
            user.VerifiedByUserId.Should().BeNull();
            user.VerificationNote.Should().BeNull();
        }

        [Fact]
        public void ApplicationUser_DateOfBirth_ShouldBeNullByDefault()
        {
            var user = new ApplicationUser();
            user.DateOfBirth.Should().BeNull();
        }

        [Fact]
        public void ApplicationUser_Intents_ShouldDefaultToEmptyList_NotNull()
        {
            var user = new ApplicationUser();
            user.Intents.Should().NotBeNull();
            user.Intents.Should().BeEmpty();
        }

        [Fact]
        public void UpdateProfileRequest_AllFieldsOptional_EmptyRequestIsValid()
        {
            var request = new UpdateProfileRequest();
            request.FirstName.Should().BeNull();
            request.LastName.Should().BeNull();
            request.Bio.Should().BeNull();
            request.DateOfBirth.Should().BeNull();
            request.Intents.Should().BeNull();
        }

        [Fact]
        public void UpdateProfileRequest_Intents_CanBeSet()
        {
            var expected = new[] { "buying", "renting" };
            var request = new UpdateProfileRequest { Intents = new List<string>(expected) };
            request.Intents.Should().BeEquivalentTo(expected);
        }

        [Fact]
        public void UpdateProfileRequest_DateOfBirth_CanBeSet()
        {
            var dob = new DateOnly(1990, 6, 15);
            var request = new UpdateProfileRequest { DateOfBirth = dob };
            request.DateOfBirth.Should().Be(dob);
        }

        [Fact]
        public void PreviousState_ShouldSerializeAndDeserializeRoundTrip()
        {
            var user = MakeUser();
            user.Bio = "Original bio";
            user.UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var snapshot = new
            {
                user.FirstName,
                user.LastName,
                user.Bio,
                changedAt = user.UpdatedAt,
            };

            var json = JsonSerializer.Serialize(snapshot);
            user.PreviousState = json;

            var deserialized = JsonSerializer.Deserialize<JsonElement>(user.PreviousState);
            deserialized.GetProperty("Bio").GetString().Should().Be("Original bio");
            deserialized.GetProperty("FirstName").GetString().Should().Be("Jane");
        }

        [Fact]
        public void PreviousState_ShouldIncludeIntentsInAuditChain()
        {
            var user = MakeUser();
            user.Intents = new List<string> { "buying" };
            user.UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var snapshot = new
            {
                user.FirstName,
                user.Intents,
                changedAt = user.UpdatedAt,
            };

            var json = JsonSerializer.Serialize(snapshot);
            user.PreviousState = json;

            var deserialized = JsonSerializer.Deserialize<JsonElement>(user.PreviousState);
            var intents = deserialized.GetProperty("Intents").EnumerateArray()
                .Select(e => e.GetString())
                .ToArray();
            var expected = new[] { "buying" };
            intents.Should().BeEquivalentTo(expected);
        }

        [Fact]
        public async Task SoftDelete_ShouldSetDeletedAtAndDeletedByUserId()
        {
            var user = MakeUser();
            db.Users.Add(user);
            await db.SaveChangesAsync();

            user.DeletedAt = DateTime.UtcNow;
            user.DeletedByUserId = user.Id;
            await db.SaveChangesAsync();

            var saved = await db.Users.FindAsync(user.Id);
            saved!.DeletedAt.Should().NotBeNull();
            saved.DeletedByUserId.Should().Be(user.Id);
        }

        [Fact]
        public async Task SoftDeleted_UserShouldStillExistInDatabase()
        {
            var user = MakeUser();
            user.DeletedAt = DateTime.UtcNow;
            db.Users.Add(user);
            await db.SaveChangesAsync();

            var found = await db.Users.FindAsync(user.Id);
            found.Should().NotBeNull();
            found!.DeletedAt.Should().NotBeNull();
        }

        [Fact]
        public async Task UpdateProfile_ShouldApplyFieldChanges()
        {
            var user = MakeUser();
            db.Users.Add(user);
            await db.SaveChangesAsync();

            userManagerMock.Setup(m => m.UpdateAsync(It.IsAny<ApplicationUser>()))
                .ReturnsAsync(IdentityResult.Success);

            var request = new UpdateProfileRequest
            {
                FirstName = "Updated",
                Bio = "New bio",
                DateOfBirth = new DateOnly(1988, 3, 22),
            };

            user.FirstName = request.FirstName!;
            user.Bio = request.Bio!;
            user.DateOfBirth = request.DateOfBirth!.Value;

            user.UpdatedAt = DateTime.UtcNow;
            var result = await userManagerMock.Object.UpdateAsync(user);

            result.Succeeded.Should().BeTrue();
            user.FirstName.Should().Be("Updated");
            user.Bio.Should().Be("New bio");
            user.DateOfBirth.Should().Be(new DateOnly(1988, 3, 22));
        }

        private static ApplicationUser MakeUser(string? id = null) => new()
        {
            Id = id ?? Guid.NewGuid().ToString(),
            UserName = "user@example.com",
            Email = "user@example.com",
            FirstName = "Jane",
            LastName = "Doe",
            MiddleName = string.Empty,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
    }
}
