// <copyright file="PropertyErasureServiceTests.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Net;
using AccountService.Configuration;
using AccountService.Data;
using AccountService.Helpers;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace AccountService.Tests.Helpers
{
    /// <summary>Unit tests for <see cref="PropertyErasureService"/> (#803).</summary>
    public sealed class PropertyErasureServiceTests : IDisposable
    {
        private const string Key = "test-internal-key-not-a-secret-0123456789";
        private const string AccountId = "0190a000-0000-7000-8000-00000000000a";

        private readonly FakeClock clock = new();
        private readonly AccountDbContext db = new(new DbContextOptionsBuilder<AccountDbContext>()
            .UseInMemoryDatabase($"PropertyErasure-{Guid.NewGuid()}")
            .Options);

        private readonly FakeHttpMessageHandler idle = new(_ => new HttpResponseMessage(HttpStatusCode.OK));
        private readonly List<HttpClient> clients = new();

        public void Dispose()
        {
            foreach (var client in this.clients)
            {
                client.Dispose();
            }

            this.idle.Dispose();
            this.db.Dispose();
        }

        [Fact]
        public async Task DrainAsync_CallsPropertyService_WithTheKey_AndRemovesTheRow()
        {
            using var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
            await this.StageAsync();

            var done = await this.CreateService(handler).DrainAsync();

            done.Should().Be(1);
            handler.Requests.Should().ContainSingle();
            var request = handler.Requests[0];
            request.Method.Should().Be(HttpMethod.Delete);
            request.RequestUri!.AbsolutePath.Should().Be($"/internal/account/{AccountId}/data");
            request.Headers.GetValues(InternalCallerOptions.HeaderName).Should().Equal(Key);
            (await this.db.PendingPropertyErasures.CountAsync()).Should().Be(0);
        }

        [Theory]
        [InlineData(HttpStatusCode.InternalServerError)]
        [InlineData(HttpStatusCode.Unauthorized)]
        public async Task DrainAsync_KeepsTheRow_AndBacksOff_WhenTheCallFails(HttpStatusCode status)
        {
            using var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(status));
            await this.StageAsync();
            var service = this.CreateService(handler);

            (await service.DrainAsync()).Should().Be(0);

            var row = await this.db.PendingPropertyErasures.SingleAsync();
            row.Attempts.Should().Be(1);
            row.NextAttemptAt.Should().BeAfter(this.clock.GetUtcNow().UtcDateTime);

            // Not due yet: the next sweep makes no call.
            (await service.DrainAsync()).Should().Be(0);
            handler.Requests.Should().ContainSingle();
        }

        [Fact]
        public async Task DrainAsync_RetriesOnTheNextSweep_AfterAnOutage()
        {
            var outage = true;
            using var handler = new FakeHttpMessageHandler(_ => outage
                ? throw new HttpRequestException("property-service is down")
                : new HttpResponseMessage(HttpStatusCode.OK));
            await this.StageAsync();
            var service = this.CreateService(handler);

            (await service.DrainAsync()).Should().Be(0);
            (await this.db.PendingPropertyErasures.CountAsync()).Should().Be(1);

            outage = false;
            this.clock.Advance(TimeSpan.FromHours(7));
            (await service.DrainAsync()).Should().Be(1);
            (await this.db.PendingPropertyErasures.CountAsync()).Should().Be(0);
        }

        [Fact]
        public async Task DrainAsync_Succeeds_ForARepeatCall()
        {
            using var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
            var service = this.CreateService(handler);

            await this.StageAsync();
            await service.DrainAsync();
            await this.StageAsync();
            (await service.DrainAsync()).Should().Be(1);
        }

        private async Task StageAsync()
        {
            this.CreateService(this.idle).Stage(AccountId);
            await this.db.SaveChangesAsync();
        }

        private PropertyErasureService CreateService(HttpMessageHandler handler)
        {
            var http = new HttpClient(handler, disposeHandler: false);
            this.clients.Add(http);
            return new PropertyErasureService(
                this.db,
                http,
                Options.Create(new InternalCallerOptions { Key = Key }),
                Options.Create(new PropertyErasureOptions()),
                this.clock,
                NullLogger<PropertyErasureService>.Instance);
        }
    }
}
