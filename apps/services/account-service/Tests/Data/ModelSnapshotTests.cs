// <copyright file="ModelSnapshotTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AccountService.Tests.Data
{
    /// <summary>
    /// Fails when the model snapshot differs from the model the code builds.
    /// </summary>
    public class ModelSnapshotTests
    {
        [Fact]
        public void Snapshot_MatchesCurrentModel()
        {
            var options = new DbContextOptionsBuilder<AccountDbContext>()
                .UseNpgsql("Host=localhost;Database=snapshot_check")
                .Options;

            using var context = new AccountDbContext(options);

            context.Database.HasPendingModelChanges().Should().BeFalse();
        }
    }
}
