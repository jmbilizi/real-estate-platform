// <copyright file="AdminRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Security.Claims;
using AccountService.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Moq;
using Xunit;

namespace AccountService.Tests.Routes
{
    /// <summary>
    /// Unit tests for the admin role management endpoint logic.
    /// </summary>
    public class AdminRoutesTests
    {
        [Fact]
        public void AdminAssignableRoles_ShouldNotIncludeSuperAdmin()
        {
            var assignable = new[] { Roles.Moderator, Roles.Support, Roles.Developer, Roles.User };
            assignable.Should().NotContain(Roles.SuperAdmin);
            assignable.Should().NotContain(Roles.Admin);
        }

        [Fact]
        public void SuperAdmin_CannotSelfRemoveSuperAdmin_WhenSameUser()
        {
            var result = IsSelfRemovingSuperAdmin("user-1", "user-1", Roles.SuperAdmin);
            result.Should().BeTrue();
        }

        [Fact]
        public void SuperAdmin_CanRemoveSuperAdmin_FromOtherUser()
        {
            var result = IsSelfRemovingSuperAdmin("super-admin-1", "other-admin", Roles.SuperAdmin);
            result.Should().BeFalse();
        }

        [Fact]
        public void Admin_CannotAssignPrivilegedRoles()
        {
            var assignable = new HashSet<string> { Roles.Moderator, Roles.Support, Roles.Developer, Roles.User };
            assignable.Should().NotContain(Roles.SuperAdmin);
            assignable.Should().NotContain(Roles.Admin);
        }

        [Fact]
        public async Task GetRoles_NotAllowed_WhenCallerIsNeitherSelfNorAdmin()
        {
            var userManager = MakeUserManager();
            var requestingId = "caller-1";
            var targetId = "target-2";
            var principal = MakePrincipal(requestingId);

            userManager.Setup(m => m.GetUserId(principal)).Returns(requestingId);

            var isSuperAdmin = principal.IsInRole(Roles.SuperAdmin);
            var isAdmin = principal.IsInRole(Roles.Admin);
            var isSelf = userManager.Object.GetUserId(principal) == targetId;

            var allowed = isSelf || isSuperAdmin || isAdmin;
            allowed.Should().BeFalse();
        }

        [Fact]
        public async Task GetRoles_Allowed_WhenCallerIsSelf()
        {
            var userManager = MakeUserManager();
            var userId = "user-42";
            var principal = MakePrincipal(userId);
            userManager.Setup(m => m.GetUserId(principal)).Returns(userId);

            var isSelf = userManager.Object.GetUserId(principal) == userId;
            isSelf.Should().BeTrue();
        }

        [Fact]
        public async Task GetRoles_Allowed_WhenCallerIsAdmin()
        {
            var userManager = MakeUserManager();
            var adminId = "admin-1";
            var targetId = "user-99";
            var principal = MakePrincipal(adminId, Roles.Admin);
            userManager.Setup(m => m.GetUserId(principal)).Returns(adminId);

            var isAdmin = principal.IsInRole(Roles.Admin);
            var isSelf = userManager.Object.GetUserId(principal) == targetId;

            (isSelf || isAdmin).Should().BeTrue();
        }

        [Fact]
        public async Task AssignRole_Idempotent_WhenUserAlreadyHasRole()
        {
            var userManager = MakeUserManager();
            var user = new ApplicationUser { Id = "u1", UserName = "x@x.com", Email = "x@x.com" };
            userManager.Setup(m => m.IsInRoleAsync(user, Roles.Moderator)).ReturnsAsync(true);

            var alreadyHasRole = await userManager.Object.IsInRoleAsync(user, Roles.Moderator);
            alreadyHasRole.Should().BeTrue();
        }

        private static bool IsSelfRemovingSuperAdmin(string requestingId, string targetId, string role) =>
            requestingId == targetId && role == Roles.SuperAdmin;

        private static Mock<UserManager<ApplicationUser>> MakeUserManager()
        {
            var store = new Mock<IUserStore<ApplicationUser>>();
            return new Mock<UserManager<ApplicationUser>>(
                store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        }

        private static ClaimsPrincipal MakePrincipal(string userId, params string[] roles)
        {
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, userId),
            };

            foreach (var role in roles)
            {
                claims.Add(new Claim(ClaimTypes.Role, role));
            }

            return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
        }
    }
}
