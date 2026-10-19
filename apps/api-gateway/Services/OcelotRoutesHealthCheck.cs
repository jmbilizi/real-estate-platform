// <copyright file="OcelotRoutesHealthCheck.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Microsoft.Extensions.Diagnostics.HealthChecks;
using Ocelot.Configuration.Repository;

namespace ApiGateway.Services
{
    /// <summary>
    /// Readiness check (#954): healthy only when Ocelot holds an internal configuration with at
    /// least one route. A pod that serves HTTP but has no routes would answer 404 to every request.
    /// </summary>
    internal sealed class OcelotRoutesHealthCheck(IInternalConfigurationRepository repository) : IHealthCheck
    {
        /// <inheritdoc/>
        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context,
            CancellationToken cancellationToken = default)
        {
            var response = repository.Get();

            if (response is null || response.IsError || response.Data is null)
            {
                return Task.FromResult(HealthCheckResult.Unhealthy("Ocelot has no internal configuration."));
            }

            int routes = response.Data.Routes?.Length ?? 0;

            return Task.FromResult(routes > 0
                ? HealthCheckResult.Healthy($"Ocelot loaded {routes} routes.")
                : HealthCheckResult.Unhealthy("Ocelot loaded no routes."));
        }
    }
}
