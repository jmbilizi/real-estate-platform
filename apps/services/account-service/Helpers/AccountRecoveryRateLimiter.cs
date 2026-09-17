// <copyright file="AccountRecoveryRateLimiter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Fixed-window request counters for the unauthenticated Identity endpoints, keyed by email address
/// and by client address.
/// </summary>
/// <remarks>
/// <para>
/// Identity ships these endpoints with no rate limit. The gateway caps them per client address at
/// the edge, but it cannot count per email address (the address is in the body) and it is not the
/// only route to the service inside the cluster.
/// </para>
/// <para>
/// Callers consult the limiter before any account lookup, so a refusal depends only on request
/// counts and never on whether the address has an account.
/// </para>
/// <para>
/// The counters live in a cache this class owns, capped by
/// <see cref="AccountRecoveryOptions.MaxTrackedKeys"/>. Half of each key is attacker-chosen, so the
/// cache must not be the shared application cache. At the cap the limiter fails closed: see
/// <see cref="TryConsume"/>.
/// </para>
/// <para>
/// Counters are per process. With N replicas the effective limit is N times the configured limit.
/// Moving the counters to Redis is the scale-out path.
/// </para>
/// </remarks>
/// <param name="options">The account-recovery options.</param>
/// <param name="timeProvider">
/// The time source for the <c>Retry-After</c> value only. Counter expiry is the cache clock's job.
/// </param>
internal sealed class AccountRecoveryRateLimiter(
    IOptions<AccountRecoveryOptions> options,
    TimeProvider timeProvider) : IDisposable
{
    // GetOrCreate is get-then-create with nothing in between. One lock over lookup and increment
    // keeps two cold-key requests from discarding each other's count.
    private readonly Lock gate = new();

    private readonly MemoryCache cache = new(new MemoryCacheOptions
    {
        SizeLimit = Math.Max(1, options.Value.MaxTrackedKeys),
    });

    /// <inheritdoc/>
    public void Dispose() => this.cache.Dispose();

    /// <summary>
    /// Counts one confirmation resend against the interval, hourly and daily limits for the address
    /// and against the client-address limit.
    /// </summary>
    /// <param name="email">The submitted email address; compared case-insensitively.</param>
    /// <param name="clientAddress">The client address, or null when unknown.</param>
    /// <param name="retryAfter">When refused, how long until every refusing window rolls over.</param>
    /// <returns><see langword="true"/> when the resend may proceed.</returns>
    internal bool TryResend(string email, string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;
        var key = email.ToUpperInvariant();

        return this.TryConsumeAll(
            out retryAfter,
            new Counter($"confirm:resend:interval:{key}", 1, settings.ResendMinimumInterval),
            new Counter($"confirm:resend:hour:{key}", settings.ResendsPerEmailPerHour, TimeSpan.FromHours(1)),
            new Counter($"confirm:resend:day:{key}", settings.ResendsPerEmailPerDay, TimeSpan.FromHours(24)),
            new Counter($"confirm:resend:addr:{clientAddress ?? "unknown"}", settings.ResendsPerAddress, settings.RequestWindow));
    }

    /// <summary>Counts one registration attempt against the client-address limit.</summary>
    /// <param name="clientAddress">The client address, or null when unknown.</param>
    /// <param name="retryAfter">When refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the registration may proceed.</returns>
    internal bool TryRegistration(string? clientAddress, out TimeSpan retryAfter) =>
        this.TryConsumeAll(
            out retryAfter,
            new Counter($"register:addr:{clientAddress ?? "unknown"}", options.Value.RegistrationsPerAddress, options.Value.RequestWindow));

    /// <summary>
    /// Consumes one unit from every counter. Every counter is consumed even after one refuses, so a
    /// caller that exhausted one limit gets no free attempts against the others.
    /// </summary>
    private bool TryConsumeAll(out TimeSpan retryAfter, params Counter[] counters)
    {
        var allowed = true;
        retryAfter = TimeSpan.Zero;

        foreach (var counter in counters)
        {
            if (counter.Window <= TimeSpan.Zero)
            {
                continue;
            }

            if (!this.TryConsume(counter.Key, counter.Limit, counter.Window, out var counterRetry))
            {
                allowed = false;
                retryAfter = counterRetry > retryAfter ? counterRetry : retryAfter;
            }
        }

        return allowed;
    }

    /// <summary>
    /// Counts one request against one counter. Refuses when the counter cannot be stored.
    /// </summary>
    /// <remarks>
    /// A full <see cref="MemoryCache"/> with a size limit does not evict to make room. It drops the
    /// new entry, and <c>GetOrCreate</c> still returns the factory value. Without the residency
    /// check every cold key would read <c>Count == 1</c> forever and the limit would silently stop
    /// applying. Refusing at capacity is visible and recoverable. Silently not limiting is neither.
    /// </remarks>
    private bool TryConsume(string key, int limit, TimeSpan window, out TimeSpan retryAfter)
    {
        var now = timeProvider.GetUtcNow();

        lock (this.gate)
        {
            var counter = this.cache.GetOrCreate(key, entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = window;
                entry.Size = 1;
                return new Window(now + window);
            })!;

            counter.Count++;
            retryAfter = counter.ExpiresAt > now ? counter.ExpiresAt - now : TimeSpan.Zero;

            if (!this.cache.TryGetValue(key, out Window? tracked) || !ReferenceEquals(tracked, counter))
            {
                retryAfter = window;
                return false;
            }

            return counter.Count <= limit;
        }
    }

    private readonly record struct Counter(string Key, int Limit, TimeSpan Window);

    private sealed class Window(DateTimeOffset expiresAt)
    {
        internal DateTimeOffset ExpiresAt { get; } = expiresAt;

        internal int Count { get; set; }
    }
}
