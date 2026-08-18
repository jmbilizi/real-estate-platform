// <copyright file="ExpiredBearerTokenFactory.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace AccountService.Tests.Integration
{
    /// <summary>
    /// A factory whose Identity bearer tokens expire the instant they are issued.
    /// <para>
    /// Lets the expired-credential path be exercised with a token that was genuinely issued by
    /// <c>POST /account/login</c> and forwarded as a real <c>Authorization</c> header — rather than a
    /// hand-built token, which would hide whatever the login path actually produces.
    /// </para>
    /// </summary>
    public class ExpiredBearerTokenFactory : AccountServiceFactory
    {
        /// <inheritdoc/>
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            ArgumentNullException.ThrowIfNull(builder);
            builder.ConfigureServices(services =>
                services.Configure<BearerTokenOptions>(
                    IdentityConstants.BearerScheme,
                    options => options.BearerTokenExpiration = TimeSpan.Zero));
        }
    }
}
