// <copyright file="WaitlistInterestKindsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Models
{
    /// <summary>
    /// Unit tests for the fixed early-access interest vocabulary.
    /// </summary>
    public class WaitlistInterestKindsTests
    {
        [Fact]
        public void All_ContainsExactlyTheThreePillarInterests()
        {
            var expected = new[] { "connect", "services-consumer", "services-provider" };
            WaitlistInterestKinds.All.Should().BeEquivalentTo(expected);
        }

        [Theory]
        [InlineData("services-consumer")]
        [InlineData("services-provider")]
        [InlineData("connect")]
        public void IsValid_ReturnsTrue_ForVocabularyValues(string interest)
        {
            WaitlistInterestKinds.IsValid(interest).Should().BeTrue();
        }

        [Theory]
        [InlineData("homes")]
        [InlineData("Connect")]
        [InlineData("services_consumer")]
        [InlineData("")]
        [InlineData(null)]
        public void IsValid_ReturnsFalse_ForUnknownValues(string? interest)
        {
            WaitlistInterestKinds.IsValid(interest).Should().BeFalse();
        }

        [Fact]
        public void Interests_AreIndependentValues_NotAPersona()
        {
            // Services consumer and Services provider are separate rows a single account may both
            // hold. A vocabulary that merged them would force a persona (PRD §11.2).
            WaitlistInterestKinds.ServicesConsumer.Should().NotBe(WaitlistInterestKinds.ServicesProvider);
            WaitlistInterestKinds.All.Should().HaveCount(3);
        }
    }
}
