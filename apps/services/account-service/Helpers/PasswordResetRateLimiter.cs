// <copyright file="PasswordResetRateLimiter.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Fixed-window request counters for the password-reset endpoints, keyed independently by email
/// address and by client address.
/// </summary>
/// <remarks>
/// <para>
/// The gateway already caps these routes per client address, which is the right place for the
/// coarse edge limit. This is the limit the service owes on its own account: the gateway is not the
/// only way to reach <c>account-service-svc</c> from inside the cluster, and the gateway cannot
/// limit per email address because the address is in the request body.
/// </para>
/// <para>
/// Counting happens before any account lookup, so the decision depends only on how many requests
/// have been made — never on whether the address names an account. A limiter consulted after the
/// lookup would reintroduce, in its own timing and response, exactly the oracle the endpoint exists
/// to avoid.
/// </para>
/// <para>
/// Counters live in this process's memory, so with more than one replica the effective limit is the
/// configured limit multiplied by the replica count. That is a weaker bound, not an absent one, and
/// it is the same trade-off the gateway's in-memory Ocelot limiter already makes. Moving the
/// counters to the cluster's Redis is the scale-out path when replica counts rise.
/// </para>
/// </remarks>
/// <param name="cache">The backing memory cache.</param>
/// <param name="options">The password-reset options.</param>
/// <param name="timeProvider">The time source, injected so tests need not sleep.</param>
internal sealed class PasswordResetRateLimiter(
    IMemoryCache cache,
    IOptions<PasswordResetOptions> options,
    TimeProvider timeProvider)
{
    /// <summary>
    /// Counts one reset <em>request</em> against both the email and the client-address limits.
    /// </summary>
    /// <param name="email">The submitted email address; compared case-insensitively.</param>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the request may proceed.</returns>
    internal bool TryRequest(string email, string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;

        // Both counters are always incremented, even if the first one refuses: a caller that has
        // exhausted one limit should not get free attempts against the other.
        var emailAllowed = this.TryConsume(
            $"pwreset:request:email:{email.ToUpperInvariant()}",
            settings.RequestsPerEmail,
            settings.RequestWindow,
            out var emailRetry);

        var addressAllowed = this.TryConsume(
            $"pwreset:request:addr:{clientAddress ?? "unknown"}",
            settings.RequestsPerAddress,
            settings.RequestWindow,
            out var addressRetry);

        retryAfter = emailAllowed ? addressRetry : emailRetry;
        return emailAllowed && addressAllowed;
    }

    /// <summary>
    /// Counts one reset <em>redemption</em> against the client-address limit, bounding token guessing.
    /// </summary>
    /// <param name="clientAddress">The client address, or null when it cannot be determined.</param>
    /// <param name="retryAfter">When the call is refused, how long until the window rolls over.</param>
    /// <returns><see langword="true"/> when the redemption may proceed.</returns>
    internal bool TryRedemption(string? clientAddress, out TimeSpan retryAfter)
    {
        var settings = options.Value;

        return this.TryConsume(
            $"pwreset:redeem:addr:{clientAddress ?? "unknown"}",
            settings.RedemptionsPerAddress,
            settings.RequestWindow,
            out retryAfter);
    }

    private bool TryConsume(string key, int limit, TimeSpan window, out TimeSpan retryAfter)
    {
        var now = timeProvider.GetUtcNow();

        var counter = cache.GetOrCreate(key, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = window;
            return new Window(now + window);
        })!;

        lock (counter)
        {
            counter.Count++;
            retryAfter = counter.ExpiresAt > now ? counter.ExpiresAt - now : TimeSpan.Zero;
            return counter.Count <= limit;
        }
    }

    private sealed class Window(DateTimeOffset expiresAt)
    {
        internal DateTimeOffset ExpiresAt { get; } = expiresAt;

        internal int Count { get; set; }
    }
}
