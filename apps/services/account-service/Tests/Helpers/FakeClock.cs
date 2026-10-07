// <copyright file="FakeClock.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

namespace AccountService.Tests.Helpers
{
    /// <summary>A <see cref="TimeProvider"/> a test moves by hand.</summary>
    internal sealed class FakeClock : TimeProvider
    {
        private DateTimeOffset now = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);

        /// <inheritdoc/>
        public override DateTimeOffset GetUtcNow() => this.now;

        /// <summary>Moves the clock forward.</summary>
        /// <param name="by">The span to add.</param>
        internal void Advance(TimeSpan by) => this.now += by;
    }
}
