// <copyright file="JsonMerger.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using Newtonsoft.Json.Linq;

namespace ApiGateway.Extensions
{
    /// <summary>
    /// Provides utility methods for merging JSON configuration files for Ocelot routing.
    /// </summary>
    internal static class JsonMerger
    {
        /// <summary>
        /// Environment variable naming the services whose route file must not be merged in this
        /// environment (comma-separated <c>ServiceName</c> values, matched case-insensitively).
        /// </summary>
        /// <remarks>
        /// <para>
        /// The <c>Active</c> flag inside a route file is global — it cannot express "routable in dev,
        /// not deployed to prod yet". Without a per-environment switch the gateway advertises every
        /// route file it ships with, so a service that <c>infra/deploy-control.yaml</c> gates off is
        /// still published: its routes answer 502, and SwaggerForOcelot fails to fetch the downstream
        /// document, which returns 500 for <c>/swagger/docs/v1/{Service}</c> and takes out the entire
        /// Swagger aggregation endpoint rather than that one document. That was the dev outage in
        /// issues #22 and #71, found by a human in a browser.
        /// </para>
        /// <para>
        /// The value is derived, not authored: <c>tools/infra/gateway-routes.js</c> computes the
        /// correct set from <c>infra/deploy-control.yaml</c> and fails <c>pnpm run infra:validate</c>
        /// unless the api-gateway Deployment for that environment declares exactly that set.
        /// </para>
        /// </remarks>
        public const string DisabledServicesEnvironmentVariable = "GATEWAY_DISABLED_SERVICES";

        /// <summary>
        /// Parses a <see cref="DisabledServicesEnvironmentVariable"/> value into a set of service names.
        /// </summary>
        /// <param name="value">The raw environment variable value; may be null, empty or whitespace.</param>
        /// <returns>The suppressed service names, compared case-insensitively.</returns>
        public static ISet<string> ParseDisabledServices(string? value)
        {
            var disabled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (string.IsNullOrWhiteSpace(value))
            {
                return disabled;
            }

            foreach (var name in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                disabled.Add(name);
            }

            return disabled;
        }

        /// <summary>
        /// Merges JSON route configuration files from a folder with a base Ocelot configuration file.
        /// </summary>
        /// <param name="folderPath">The path to the folder containing route configuration JSON files.</param>
        /// <param name="baseFilePath">The path to the base Ocelot configuration file.</param>
        /// <param name="disabledServices">
        /// Service names to suppress for this environment. A suppressed file contributes neither its
        /// <c>Routes</c> nor its <c>SwaggerEndPoints</c> entry — the Swagger endpoint is exactly what
        /// produced the 500, so dropping the routes alone would not fix it.
        /// </param>
        /// <returns>A JSON string containing the merged configuration.</returns>
        public static string MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(string folderPath, string baseFilePath, ISet<string>? disabledServices = null)
        {
            // Read the base JSON file
            string baseJson = File.ReadAllText(baseFilePath);
            JObject mergedObj = JObject.Parse(baseJson);

            // Check if folder exists and has files
            if (!Directory.Exists(folderPath))
            {
                // Return base config if folder doesn't exist yet
                return mergedObj.ToString();
            }

            var jsonFiles = Directory.GetFiles(folderPath, "*.json");
            if (jsonFiles.Length == 0)
            {
                // Return base config if no route files exist yet
                return mergedObj.ToString();
            }

            // Loop through JSON files in the folder
            foreach (var filePath in jsonFiles)
            {
                string json = File.ReadAllText(filePath);

                JObject obj = JObject.Parse(json);

                // Merge the 'Routes' arrays only if it an active micro-service that this
                // environment actually deploys — see DisabledServicesEnvironmentVariable.
                if (IsActiveService(obj) && !IsSuppressedService(obj, disabledServices))
                {
                    MergeModifiedRoutes(mergedObj, obj);
                }
            }

            // return a Converted merged object to JSON string
            return mergedObj.ToString();
        }

        private static void MergeModifiedRoutes(JObject target, JObject source)
        {
            if (target["Routes"] is JArray targetRoutes && source["Routes"] is JArray sourceRoutes)
            {
                var swaggerKey = (string?)source["ServiceName"];

                if (swaggerKey != null)
                {
                    foreach (var route in sourceRoutes)
                    {
                        // Modify route object here as needed
                        route["SwaggerKey"] = swaggerKey;
                    }
                }

                // Merge routes
                targetRoutes.Merge(sourceRoutes, new JsonMergeSettings
                {
                    MergeArrayHandling = MergeArrayHandling.Union,
                });

                if (target["SwaggerEndPoints"] is JArray targetSwaggerEndPoints && source["SwaggerEndPoints"] is JArray sourceSwaggerEndPoints)
                {
                    // Merge SwaggerEndPoints
                    targetSwaggerEndPoints.Merge(sourceSwaggerEndPoints, new JsonMergeSettings
                    {
                        MergeArrayHandling = MergeArrayHandling.Union,
                    });
                }
            }
        }

        private static bool IsSuppressedService(JObject obj, ISet<string>? disabledServices)
        {
            if (disabledServices is null || disabledServices.Count == 0)
            {
                return false;
            }

            var serviceName = (string?)obj["ServiceName"];
            return serviceName is not null && disabledServices.Contains(serviceName);
        }

        private static bool IsActiveService(JObject obj)
        {
            JToken activeToken;
            return obj.TryGetValue("Active", out activeToken!) && activeToken.Type == JTokenType.Boolean && (bool)activeToken!;
        }
    }
}
