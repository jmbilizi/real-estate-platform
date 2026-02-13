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
        /// Merges JSON route configuration files from a folder with a base Ocelot configuration file.
        /// </summary>
        /// <param name="folderPath">The path to the folder containing route configuration JSON files.</param>
        /// <param name="baseFilePath">The path to the base Ocelot configuration file.</param>
        /// <returns>A JSON string containing the merged configuration.</returns>
        public static string MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(string folderPath, string baseFilePath)
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

                // Merge the 'Routes' arrays only if it an active micro-service
                if (IsActiveService(obj))
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

        private static bool IsActiveService(JObject obj)
        {
            JToken activeToken;
            return obj.TryGetValue("Active", out activeToken!) && activeToken.Type == JTokenType.Boolean && (bool)activeToken!;
        }
    }
}
