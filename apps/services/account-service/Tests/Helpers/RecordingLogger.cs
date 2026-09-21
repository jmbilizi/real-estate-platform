// <copyright file="RecordingLogger.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.Extensions.Logging;

namespace AccountService.Tests.Helpers
{
    /// <summary>An <see cref="ILogger{T}"/> that records every entry for a test to inspect.</summary>
    /// <typeparam name="T">The category type, matching an injected <c>ILogger&lt;T&gt;</c>.</typeparam>
    internal sealed class RecordingLogger<T> : ILogger<T>
    {
        /// <summary>Gets every entry logged so far, in order.</summary>
        internal List<(LogLevel Level, EventId EventId, string Message)> Entries { get; } = new();

        /// <inheritdoc/>
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        /// <inheritdoc/>
        public bool IsEnabled(LogLevel logLevel) => true;

        /// <inheritdoc/>
        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            this.Entries.Add((logLevel, eventId, formatter(state, exception)));
        }
    }
}
