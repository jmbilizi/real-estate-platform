// <copyright file="CapturingLoggerProvider.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.Extensions.Logging;

namespace AccountService.Tests.Integration
{
    /// <summary>Records every log entry a test host writes.</summary>
    internal sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<LogEntry> entries = new();

        /// <summary>Gets the entries written so far.</summary>
        internal IReadOnlyList<LogEntry> Entries
        {
            get
            {
                lock (this.entries)
                {
                    return this.entries.ToList();
                }
            }
        }

        /// <inheritdoc/>
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, this.Add);

        /// <inheritdoc/>
        public void Dispose()
        {
        }

        private void Add(LogEntry entry)
        {
            lock (this.entries)
            {
                this.entries.Add(entry);
            }
        }

        /// <summary>One log entry.</summary>
        /// <param name="Category">The logger category.</param>
        /// <param name="Level">The level.</param>
        /// <param name="EventId">The event id.</param>
        /// <param name="Message">The formatted message.</param>
        internal sealed record LogEntry(string Category, LogLevel Level, EventId EventId, string Message);

        private sealed class CapturingLogger(string category, Action<LogEntry> add) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                ArgumentNullException.ThrowIfNull(formatter);
                add(new LogEntry(category, logLevel, eventId, formatter(state, exception)));
            }
        }
    }
}
