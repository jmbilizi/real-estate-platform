// <copyright file="AccountRecoveryRateLimiter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Fixed-window request counters for the unauthenticated Identity endpoints — registration, email
/// confirmation resend, and password reset — keyed by email address and by client address.
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
/// cache must not be the shared application cache. At the cap the limiter compacts and retries
/// before it refuses: see <see cref="TryConsume"/>.
/// </para>
/// <para>
/// At the cap this limiter <b>fails closed</b> — a request whose counter cannot be stored is
/// refused rather than waved through. See <see cref="TryConsume"/> for why that check exists and
/// what it costs; it is not optional, and removing it turns the limiter off under exactly the load
/// it exists to survive.
/// </para>
/// <para>
/// Counters are per process, so with more than one replica the effective limit is the configured
/// limit multiplied by the replica count. That is a weaker bound, not an absent one, and it is the
/// same trade-off the gateway's in-memory Ocelot limiter already makes. Moving the counters to the
/// cluster's Redis is the scale-out path when replica counts rise.
/// </para>
/// </remarks>
/// <param name="options">The account-recovery options.</param>
/// <param name="timeProvider">
/// The time source for the <c>Retry-After</c> the caller is told to wait. It does <b>not</b> govern
/// when a counter expires: that is <see cref="MemoryCacheOptions.Clock"/>'s job and the two are not
/// wired together, so advancing a fake provider moves the reported retry-after without rolling the
/// window. Worth knowing before writing a window-rollover test against it — there is no coverage of
/// rollover today for exactly that reason.
/// </param>
internal sealed class AccountRecoveryRateLimiter(
    IOptions<AccountRecoveryOptions> options,
    TimeProvider timeProvider) : IDisposable
{
    /// <summary>The share of the counter cache dropped when it is full.</summary>
    private const double CompactionShare = 0.1;

    /// <summary>The smallest counter cache, so <see cref="CompactionShare"/> evicts at least one.</summary>
    private const int MinimumTrackedKeys = 16;

    // GetOrCreate is get-then-create with nothing in between. One lock over lookup and increment
    // keeps two cold-key requests from discarding each other's count.
    private readonly Lock gate = new();

    private readonly MemoryCache cache = new(new MemoryCacheOptions
    {
        // Compaction drops a share of the current size, so it can never evict from a cache of one
        // or two. The floor keeps a share of at least one entry.
        SizeLimit = Math.Max(MinimumTrackedKeys, options.Value.MaxTrackedKeys),
    });

    /// <inheritdoc/>
    public void Dispose() => this.cache.Dispose();

    /// <summary>
    /// Counts one password-reset <em>request</em> against both the email and the client-address
    /// limits.
    /// </summary>
    /// <remarks>
    /// Both counters are charged independently, even when one already refuses: a caller who has
    /// exhausted the email budget must not get free, unmetered attempts against the address budget.
    /// </remarks>
    /// <param name="email">The submitted email address; compared case-insensitively.</param>
    /// <param name="clientAddress">The client address, or null when unknown.</param>
    /// <param name="retryAfter">When refused, how long until the refusing counter rolls over.</param>
    /// <returns><see langword="true"/> when the request may proceed.</returns>
    internal bool TryRequest(string email, string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;
        var key = email.ToUpperInvariant();

        return this.TryConsumePair(
            $"pwreset:request:email:{key}",
            $"pwreset:request:addr:{clientAddress ?? "unknown"}",
            settings.RequestsPerEmail,
            settings.RequestsPerAddress,
            settings.RequestWindow,
            out retryAfter);
    }

    /// <summary>
    /// Counts one reset <em>redemption</em> against the client-address limit, bounding token
    /// guessing.
    /// </summary>
    /// <param name="clientAddress">The client address, or null when unknown.</param>
    /// <param name="retryAfter">When refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the redemption may proceed.</returns>
    internal bool TryRedemption(string? clientAddress, out TimeSpan retryAfter) =>
        this.TryConsumeAll(
            out retryAfter,
            new Counter($"pwreset:redeem:addr:{clientAddress ?? "unknown"}", options.Value.RedemptionsPerAddress, options.Value.RequestWindow));

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
    /// Consumes one unit from each counter in turn and stops at the first refusal.
    /// </summary>
    /// <remarks>
    /// The refusing counter is still consumed, so a caller cannot retry past a limit for free. The
    /// counters after it are not. A refused request is never served, so it must not spend the long
    /// windows: the shortest window comes first, which caps how fast anyone can burn an address's
    /// longer-window budget. Charging every counter let 10 requests in one second lock an address out
    /// for a day.
    /// </remarks>
    private bool TryConsumeAll(out TimeSpan retryAfter, params Counter[] counters)
    {
        retryAfter = TimeSpan.Zero;

        foreach (var counter in counters)
        {
            if (counter.Window <= TimeSpan.Zero)
            {
                continue;
            }

            if (!this.TryConsume(counter.Key, counter.Limit, counter.Window, out retryAfter))
            {
                return false;
            }
        }

        retryAfter = TimeSpan.Zero;
        return true;
    }

    /// <summary>
    /// Consumes one unit from an email-keyed counter and one from an address-keyed counter,
    /// independently.
    /// </summary>
    /// <remarks>
    /// Both counters are always consumed, even when the first one refuses: a caller who has
    /// exhausted one limit must not get free attempts against the other.
    /// </remarks>
    private bool TryConsumePair(
        string emailKey,
        string addressKey,
        int emailLimit,
        int addressLimit,
        TimeSpan window,
        out TimeSpan retryAfter)
    {
        var emailAllowed = this.TryConsume(emailKey, emailLimit, window, out var emailRetry);
        var addressAllowed = this.TryConsume(addressKey, addressLimit, window, out var addressRetry);

        retryAfter = emailAllowed ? addressRetry : emailRetry;
        return emailAllowed && addressAllowed;
    }

    /// <summary>
    /// Counts one request against one counter, and refuses when the counter cannot be tracked.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The residency check is the whole point of this method and must not be removed.</b>
    /// <see cref="MemoryCache"/> with a <see cref="MemoryCacheOptions.SizeLimit"/> does <em>not</em>
    /// evict-then-add when it is full: it refuses to store the entry, marks it
    /// <c>EvictionReason.Capacity</c>, and schedules a background compaction that frees only
    /// <see cref="MemoryCacheOptions.CompactionPercentage"/> (5% by default). But
    /// <see cref="CacheExtensions.GetOrCreate{TItem}(IMemoryCache, object, Func{ICacheEntry, TItem})"/>
    /// still returns the factory's value, so without this check a cold key came back with
    /// <c>Count == 1</c> on <em>every</em> request and the limit silently stopped applying.
    /// </para>
    /// <para>
    /// That fail-open was reachable, not theoretical: half of every key is a caller-chosen email
    /// address and the other half a caller-asserted <c>X-Real-IP</c> (#143), so an attacker can fill
    /// the cache deliberately and then enjoy an unmetered endpoint — including against a victim's
    /// address once its counter has been evicted.
    /// </para>
    /// <para>
    /// <b>The trade this makes.</b> Failing closed at capacity means a full cache refuses recovery
    /// requests it cannot account for, which is a denial-of-recovery an attacker can also aim for.
    /// That is the better of the two failures: a limiter that refuses is doing a recognisable,
    /// alertable thing, where one that silently stops limiting looks healthy while providing no
    /// protection at all. <see cref="AccountRecoveryOptions.MaxTrackedKeys"/> is sized so ordinary
    /// traffic never approaches it. Surfacing capacity exhaustion as a metric or a throttled log
    /// line is a genuine gap and is noted on the ticket rather than bolted on here.
    /// </para>
    /// </remarks>
    private bool TryConsume(string key, int limit, TimeSpan window, out TimeSpan retryAfter)
    {
        var now = timeProvider.GetUtcNow();

        lock (this.gate)
        {
            var counter = this.GetOrCreate(key, window, now);

            if (!this.IsTracked(key, counter))
            {
                // Oldest first. The evicted counters lose their history, which is the same
                // exposure as a process restart and is bounded by the compaction share.
                this.cache.Compact(CompactionShare);
                counter = this.GetOrCreate(key, window, now);

                if (!this.IsTracked(key, counter))
                {
                    retryAfter = window;
                    return false;
                }
            }

            counter.Count++;
            retryAfter = counter.ExpiresAt > now ? counter.ExpiresAt - now : TimeSpan.Zero;

            // Did the counter actually get stored? If not, the cache is at capacity and this
            // increment is about to be forgotten — so there is no counting happening for this key
            // and the only safe answer is no.
            if (!this.cache.TryGetValue(key, out Window? tracked) || !ReferenceEquals(tracked, counter))
            {
                retryAfter = window;
                return false;
            }

            return counter.Count <= limit;
        }
    }

    private Window GetOrCreate(string key, TimeSpan window, DateTimeOffset now) =>
        this.cache.GetOrCreate(key, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = window;
            entry.Size = 1;
            return new Window(now + window);
        })!;

    private bool IsTracked(string key, Window counter) =>
        this.cache.TryGetValue(key, out Window? tracked) && ReferenceEquals(tracked, counter);

    private readonly record struct Counter(string Key, int Limit, TimeSpan Window);

    private sealed class Window(DateTimeOffset expiresAt)
    {
        internal DateTimeOffset ExpiresAt { get; } = expiresAt;

        internal int Count { get; set; }
    }
}
