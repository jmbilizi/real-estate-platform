// <copyright file="RolesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Models
{
    /// <summary>
    /// Tests for <see cref="Roles"/> constants.
    /// </summary>
    public class RolesTests
    {
        [Fact]
        public void AllRoleConstants_ShouldBeNonEmpty()
        {
            var roles = new[]
            {
                Roles.SuperAdmin,
                Roles.Admin,
                Roles.Moderator,
                Roles.Support,
                Roles.Developer,
                Roles.User,
            };

            roles.Should().AllSatisfy(r => r.Should().NotBeNullOrWhiteSpace());
        }

        [Fact]
        public void AllRoleConstants_ShouldBeDistinct()
        {
            var roles = new[]
            {
                Roles.SuperAdmin,
                Roles.Admin,
                Roles.Moderator,
                Roles.Support,
                Roles.Developer,
                Roles.User,
            };

            roles.Should().OnlyHaveUniqueItems();
        }

        [Theory]
        [InlineData(Roles.SuperAdmin, "SuperAdmin")]
        [InlineData(Roles.Admin, "Admin")]
        [InlineData(Roles.Moderator, "Moderator")]
        [InlineData(Roles.Support, "Support")]
        [InlineData(Roles.Developer, "Developer")]
        [InlineData(Roles.User, "User")]
        public void RoleConstant_ShouldMatchExpectedValue(string actual, string expected)
        {
            actual.Should().Be(expected);
        }
    }
}
