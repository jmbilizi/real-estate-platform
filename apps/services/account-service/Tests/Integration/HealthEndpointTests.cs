// <copyright file="HealthEndpointTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using FluentAssertions;
using Xunit;

#pragma warning disable CA2234 // Pass Uri objects instead of strings

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// Integration tests for the health check endpoints.
    /// </summary>
    public class HealthEndpointTests(AccountServiceFactory factory)
        : IClassFixture<AccountServiceFactory>
    {
        private readonly HttpClient client = factory.CreateClient();

        [Fact]
        public async Task GetHealth_ReturnsOk()
        {
            var response = await client.GetAsync("/account/health");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetHealthReady_ReturnsOk()
        {
            var response = await client.GetAsync("/account/health/ready");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task GetHealth_ReturnsHealthyBody()
        {
            var response = await client.GetAsync("/account/health");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("healthy");
        }

        [Fact]
        public async Task GetHealthReady_ReturnsReadyBody()
        {
            var response = await client.GetAsync("/account/health/ready");
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("ready");
        }
    }
}
