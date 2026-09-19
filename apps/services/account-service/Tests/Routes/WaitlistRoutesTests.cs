// <copyright file="WaitlistRoutesTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Routes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace AccountService.Tests.Routes
{
    /// <summary>
    /// Unit tests for the waitlist duplicate-key predicate. The integration suite runs on the EF
    /// Core in-memory provider, which never raises a Postgres key violation, so the narrowing
    /// itself is tested here.
    /// </summary>
    public class WaitlistRoutesTests
    {
        [Fact]
        public void IsDuplicateKeyViolation_ReturnsTrue_ForUniqueViolation()
        {
            var exception = new DbUpdateException("save failed", BuildPostgresException("23505"));

            Waitlist.IsDuplicateKeyViolation(exception).Should().BeTrue();
        }

        [Theory]
        [InlineData("23503")] // foreign key violation
        [InlineData("40001")] // serialization failure
        [InlineData("53100")] // disk full
        [InlineData("57014")] // statement timeout
        public void IsDuplicateKeyViolation_ReturnsFalse_ForOtherDatabaseFailures(string sqlState)
        {
            // These must surface as a 500. Reporting them as a successful registration would tell
            // the client a row exists when the write was lost.
            var exception = new DbUpdateException("save failed", BuildPostgresException(sqlState));

            Waitlist.IsDuplicateKeyViolation(exception).Should().BeFalse();
        }

        [Fact]
        public void IsDuplicateKeyViolation_ReturnsFalse_ForANonPostgresInnerException()
        {
            var exception = new DbUpdateException("save failed", new TimeoutException());

            Waitlist.IsDuplicateKeyViolation(exception).Should().BeFalse();
        }

        [Fact]
        public void IsDuplicateKeyViolation_ReturnsFalse_WhenThereIsNoInnerException()
        {
            Waitlist.IsDuplicateKeyViolation(new DbUpdateException("save failed")).Should().BeFalse();
        }

        private static PostgresException BuildPostgresException(string sqlState) =>
            new(
                messageText: "violation",
                severity: "ERROR",
                invariantSeverity: "ERROR",
                sqlState: sqlState);
    }
}
