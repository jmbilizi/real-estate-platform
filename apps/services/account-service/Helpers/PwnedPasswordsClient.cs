// <copyright file="PwnedPasswordsClient.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using AccountService.Configuration;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// The HIBP Pwned Passwords range client (k-anonymity, <c>Add-Padding: true</c>).
/// </summary>
/// <remarks>
/// The request path carries the 5 character SHA-1 prefix. Nothing here logs the password, the hash,
/// the prefix or the exception text, which can hold the request URL. The HTTP client registration
/// removes the framework's own request logging for the same reason. A failure returns
/// <see langword="null"/>. The caller fails open.
/// </remarks>
/// <param name="httpClient">The configured HTTP client.</param>
/// <param name="options">The policy options.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class PwnedPasswordsClient(
    HttpClient httpClient,
    IOptions<PasswordPolicyOptions> options,
    ILogger<PwnedPasswordsClient> logger) : IPwnedPasswordsClient
{
    private const int PrefixLength = 5;

    /// <inheritdoc/>
    public async Task<bool?> IsBreachedAsync(string password, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(password);

        // SHA-1 is the API's required key. It is not a security use.
#pragma warning disable CA5350
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(password)));
#pragma warning restore CA5350
        var prefix = hash[..PrefixLength];
        var suffix = hash[PrefixLength..];

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.Value.BreachCheckTimeout);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "range/" + prefix);
            request.Headers.Add("Add-Padding", "true");
            using var response = await httpClient.SendAsync(request, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                LogUnavailable(logger, (int)response.StatusCode);
                return null;
            }

            var body = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var parts = line.Split(':');
                if (parts.Length == 2
                    && string.Equals(parts[0], suffix, StringComparison.OrdinalIgnoreCase)
                    && long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var count))
                {
                    // Padding entries carry a count of 0.
                    return count > 0;
                }
            }

            return false;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            LogUnavailable(logger, 0);
            return null;
        }
#pragma warning disable CA1031 // Any other failure lets the password pass. The caller's cancel is not one.
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
#pragma warning restore CA1031
        {
            LogUnavailable(logger, 0);
            return null;
        }
    }

    [LoggerMessage(1390, LogLevel.Warning, "The breached-password check was unavailable (status {Status}, 0 means no answer). The password was not checked.", EventName = "BreachCheckUnavailable")]
    private static partial void LogUnavailable(ILogger logger, int status);
}
