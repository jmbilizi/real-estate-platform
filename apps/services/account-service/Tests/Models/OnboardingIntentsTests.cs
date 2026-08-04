// <copyright file="OnboardingIntentsTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Models;
using FluentAssertions;
using Xunit;

namespace AccountService.Tests.Models
{
    /// <summary>
    /// Tests for the <see cref="OnboardingIntents"/> fixed vocabulary (PRD §4.4).
    /// </summary>
    public class OnboardingIntentsTests
    {
        [Fact]
        public void All_ShouldContainExactlySixValues()
        {
            OnboardingIntents.All.Should().HaveCount(6);
        }

        [Fact]
        public void All_ShouldMatchSpecWording()
        {
            var expected = new[]
            {
                "buying",
                "selling",
                "renting",
                "owning",
                "offering_services",
                "exploring_career",
            };

            OnboardingIntents.All.Should().BeEquivalentTo(expected);
        }

        [Fact]
        public void FindInvalid_ShouldReturnEmpty_WhenAllValuesAreKnown()
        {
            var requested = new[] { "buying", "renting" };
            var invalid = OnboardingIntents.FindInvalid(requested);
            invalid.Should().BeEmpty();
        }

        [Fact]
        public void FindInvalid_ShouldReturnEmpty_WhenGivenEmptyList()
        {
            var invalid = OnboardingIntents.FindInvalid(Array.Empty<string>());
            invalid.Should().BeEmpty();
        }

        [Fact]
        public void FindInvalid_ShouldReturnUnknownValues_WhenGivenInvalidIntent()
        {
            var requested = new[] { "buying", "not_a_real_intent" };
            var invalid = OnboardingIntents.FindInvalid(requested);
            invalid.Should().ContainSingle().Which.Should().Be("not_a_real_intent");
        }
    }
}
