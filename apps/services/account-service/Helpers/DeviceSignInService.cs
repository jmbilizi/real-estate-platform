// <copyright file="DeviceSignInService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Configuration;
using AccountService.Models;
using Microsoft.Extensions.Options;

namespace AccountService.Helpers;

/// <summary>
/// Sends the new-device code (#818) through <see cref="EmailCodeService"/>, with the cooldown and
/// caps of the engine.
/// </summary>
/// <param name="codes">The code engine.</param>
/// <param name="codeOptions">The engine options.</param>
internal sealed class DeviceSignInService(EmailCodeService codes, IOptions<EmailCodeOptions> codeOptions)
{
    /// <summary>Sends a <see cref="EmailCodePurpose.NewDeviceSignIn"/> code to the account.</summary>
    /// <param name="user">The account. The caller has checked its password.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>What happened.</returns>
    internal async Task<DeviceCodeSend> SendAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(user);

        var options = codeOptions.Value;
        var result = await codes.IssueAsync(user.Email!, EmailCodePurpose.NewDeviceSignIn, user.Id, cancellationToken).ConfigureAwait(false);
        return result.Status switch
        {
            EmailCodeIssueStatus.Issued => new DeviceCodeSend(
                result.Status,
                EmailCodeService.CeilSeconds(options.ResendCooldown),
                EmailCodeService.CeilSeconds(options.Lifetime),
                null),
            EmailCodeIssueStatus.Locked => new DeviceCodeSend(
                result.Status,
                result.RetryAfterSeconds,
                0,
                CodeSendOutcome.Locked.Reason()),
            EmailCodeIssueStatus.Throttled => new DeviceCodeSend(
                result.Status,
                result.RetryAfterSeconds,
                0,
                result.Outcome.Reason()),
            _ => new DeviceCodeSend(result.Status, 0, 0, null),
        };
    }
}
