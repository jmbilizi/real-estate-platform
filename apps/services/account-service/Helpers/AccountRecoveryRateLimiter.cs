// <copyright file="AccountRecoveryRateLimiter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Fixed-window request counters for the unauthenticated account-recovery endpoints, keyed
/// independently by email address and by client address.
/// </summary>
/// <remarks>
/// <para>
/// The endpoints these guard are ASP.NET Core Identity's own, and Identity ships them with
/// <em>no</em> rate limiting: there is no <c>RequireRateLimiting</c>, no throttling metadata and no
/// counter anywhere in <c>MapIdentityApi</c>'s group. The only brute-force control in the whole
/// group is Identity's lockout, and that applies to <c>/login</c> alone. So registration, password
/// reset requests, reset redemptions and confirmation resends are all unmetered out of the box —
/// which for the three that send mail means an unmetered mail cannon, and for redemption means
/// unmetered token guessing.
/// </para>
/// <para>
/// The gateway already caps these routes per client address, which is the right place for the
/// coarse edge limit. This is the limit the service owes on its own account: the gateway is not the
/// only way to reach <c>account-service-svc</c> from inside the cluster, and the gateway cannot
/// limit per email address because the address is in the request body.
/// </para>
/// <para>
/// Counting happens before any account lookup, so the decision depends only on how many requests
/// have been made — never on whether the address names an account. A limiter consulted after the
/// lookup would reintroduce, in its own timing and response, exactly the oracle these endpoints
/// must not be.
/// </para>
/// <para>
/// The counters live in a cache this limiter owns, capped by
/// <see cref="AccountRecoveryOptions.MaxTrackedKeys"/>. They must not share the application cache:
/// the email half of the key is attacker-chosen and an entry is created before the request is
/// refused, so an unbounded cache would grow by one entry per flooded request and evict unrelated
/// data. At the cap this limiter <b>fails closed</b> — a request whose counter cannot be stored is
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
    /// <summary>
    /// Guards read-modify-write of a counter.
    /// </summary>
    /// <remarks>
    /// <see cref="CacheExtensions.GetOrCreate{TItem}(IMemoryCache, object, Func{ICacheEntry, TItem})"/>
    /// is get-then-create with nothing in between, so two requests arriving together on a cold or
    /// just-expired key both miss, both create, and the second commit discards the first — along
    /// with its count. One lock over the whole operation is the simple correct answer here: the
    /// critical section is a dictionary lookup and an integer increment, and the endpoints it guards
    /// are deliberately slow.
    /// </remarks>
    private readonly Lock gate = new();

    private readonly MemoryCache cache = new(new MemoryCacheOptions
    {
        SizeLimit = Math.Max(1, options.Value.MaxTrackedKeys),
    });

    /// <inheritdoc/>
    public void Dispose() => this.cache.Dispose();

    /// <summary>
    /// Counts one password-reset <em>request</em> against both the email and the client-address
    /// limits.
    /// </summary>
    /// <param name="email">The submitted email address; compared case-insensitively.</param>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the request may proceed.</returns>
    internal bool TryRequest(string email, string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;

        return this.TryConsumePair(
            "pwreset:request",
            email,
            clientAddress,
            settings.RequestsPerEmail,
            settings.RequestsPerAddress,
            out retryAfter);
    }

    /// <summary>
    /// Counts one confirmation-email <em>resend</em> against both the email and the client-address
    /// limits.
    /// </summary>
    /// <param name="email">The submitted email address; compared case-insensitively.</param>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the resend may proceed.</returns>
    internal bool TryResend(string email, string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;

        return this.TryConsumePair(
            "confirm:resend",
            email,
            clientAddress,
            settings.ResendsPerEmail,
            settings.ResendsPerAddress,
            out retryAfter);
    }

    /// <summary>
    /// Counts one reset <em>redemption</em> against the client-address limit, bounding token guessing.
    /// </summary>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the redemption may proceed.</returns>
    internal bool TryRedemption(string? clientAddress, out TimeSpan retryAfter) =>
        this.TryConsume(
            $"pwreset:redeem:addr:{clientAddress ?? "unknown"}",
            options.Value.RedemptionsPerAddress,
            options.Value.RequestWindow,
            out retryAfter);

    /// <summary>
    /// Counts one <em>registration</em> attempt against the client-address limit.
    /// </summary>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the registration may proceed.</returns>
    internal bool TryRegistration(string? clientAddress, out TimeSpan retryAfter) =>
        this.TryConsume(
            $"register:addr:{clientAddress ?? "unknown"}",
            options.Value.RegistrationsPerAddress,
            options.Value.RequestWindow,
            out retryAfter);

    /// <summary>
    /// Consumes one unit from an email-keyed counter and one from an address-keyed counter.
    /// </summary>
    /// <remarks>
    /// Both counters are always consumed, even if the first one refuses: a caller that has
    /// exhausted one limit should not get free attempts against the other.
    /// </remarks>
    private bool TryConsumePair(
        string prefix,
        string email,
        string? clientAddress,
        int emailLimit,
        int addressLimit,
        out TimeSpan retryAfter)
    {
        var window = options.Value.RequestWindow;

        var emailAllowed = this.TryConsume(
            $"{prefix}:email:{email.ToUpperInvariant()}",
            emailLimit,
            window,
            out var emailRetry);

        var addressAllowed = this.TryConsume(
            $"{prefix}:addr:{clientAddress ?? "unknown"}",
            addressLimit,
            window,
            out var addressRetry);

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
            var counter = this.cache.GetOrCreate(key, entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = window;
                entry.Size = 1;
                return new Window(now + window);
            })!;

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

    private sealed class Window(DateTimeOffset expiresAt)
    {
        internal DateTimeOffset ExpiresAt { get; } = expiresAt;

        internal int Count { get; set; }
    }
}
