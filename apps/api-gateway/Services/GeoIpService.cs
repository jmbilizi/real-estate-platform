// <copyright file="GeoIpService.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;
using System.Net;
using MaxMind.GeoIP2;
using MaxMind.GeoIP2.Exceptions;

namespace ApiGateway.Services
{
    /// <summary>
    /// Service for performing GeoIP lookups using MaxMind GeoIP2 database.
    /// Provides geographic location data (country, city, coordinates) from IP addresses.
    /// </summary>
    [SuppressMessage("Performance", "CA1515:Consider making public types internal", Justification = "May be used by other services in the future")]
    public sealed class GeoIpService : IDisposable
    {
        private static readonly Action<ILogger, Exception?> LogGeoIpDisabledAction =
            LoggerMessage.Define(
                LogLevel.Information,
                new EventId(100, "GeoIpDisabled"),
                "GeoIP lookups are DISABLED (GEOIP_ENABLED=false)");

        private static readonly Action<ILogger, string, Exception?> LogDatabaseNotFoundAction =
            LoggerMessage.Define<string>(
                LogLevel.Warning,
                new EventId(101, "GeoIpDatabaseNotFound"),
                "GeoIP database not found at {Path}. GeoIP lookups will be disabled. Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data");

        private static readonly Action<ILogger, string, DateTimeOffset, Exception?> LogGeoIpInitializedAction =
            LoggerMessage.Define<string, DateTimeOffset>(
                LogLevel.Information,
                new EventId(102, "GeoIpInitialized"),
                "GeoIP service initialized successfully with database: {Path} (Build: {BuildDate})");

        private static readonly Action<ILogger, string, Exception?> LogGeoIpInitFailedAction =
            LoggerMessage.Define<string>(
                LogLevel.Error,
                new EventId(103, "GeoIpInitFailed"),
                "Failed to initialize GeoIP database at {Path}");

        private static readonly Action<ILogger, string, Exception?> LogGeoIpLookupFailedAction =
            LoggerMessage.Define<string>(
                LogLevel.Warning,
                new EventId(104, "GeoIpLookupFailed"),
                "GeoIP lookup failed for {IpAddress}");

        private static readonly Action<ILogger, string, Exception?> LogGeoIpUnexpectedErrorAction =
            LoggerMessage.Define<string>(
                LogLevel.Error,
                new EventId(105, "GeoIpUnexpectedError"),
                "Unexpected error during GeoIP lookup for {IpAddress}");

        private readonly DatabaseReader? reader;
        private readonly ILogger<GeoIpService> logger;
        private readonly bool isEnabled;

        /// <summary>
        /// Initializes a new instance of the <see cref="GeoIpService"/> class.
        /// </summary>
        /// <param name="configuration">The application configuration.</param>
        /// <param name="logger">The logger instance.</param>
        [SuppressMessage("Design", "CA1031:Do not catch general exception types", Justification = "Service initialization should not crash application")]
        public GeoIpService(IConfiguration configuration, ILogger<GeoIpService> logger)
        {
            ArgumentNullException.ThrowIfNull(configuration);

            this.logger = logger;

            // Read GeoIP configuration
            bool geoipEnabled = configuration.GetValue("GEOIP_ENABLED", false);

            if (!geoipEnabled)
            {
                LogGeoIpDisabledAction(logger, null);
                isEnabled = false;
                return;
            }

            // Standard database path with fallbacks for local development
            // Priority order:
            // 1. /opt/geoip/GeoLite2-City.mmdb (container standard)
            // 2. apps/api-gateway/GeoLite2-City.mmdb (local dev from workspace root)
            // 3. GeoLite2-City.mmdb (local dev from project directory)
            string[] candidatePaths =
            [
                "/opt/geoip/GeoLite2-City.mmdb",
                Path.Combine(Directory.GetCurrentDirectory(), "apps", "api-gateway", "GeoLite2-City.mmdb"),
                Path.Combine(Directory.GetCurrentDirectory(), "GeoLite2-City.mmdb"),
            ];

            string? databasePath = null;
            foreach (string candidate in candidatePaths)
            {
                if (File.Exists(candidate))
                {
                    databasePath = candidate;
                    break;
                }
            }

            if (databasePath == null)
            {
                LogDatabaseNotFoundAction(logger, string.Join(", ", candidatePaths), null);
                isEnabled = false;
                return;
            }

            try
            {
                reader = new DatabaseReader(databasePath);
                isEnabled = true;
                LogGeoIpInitializedAction(logger, databasePath, reader.Metadata.BuildDate, null);
            }
            catch (Exception ex)
            {
                LogGeoIpInitFailedAction(logger, databasePath, ex);
                isEnabled = false;
            }
        }

        /// <summary>
        /// Gets a value indicating whether GeoIP lookups are enabled.
        /// </summary>
        public bool IsEnabled => isEnabled;

        /// <summary>
        /// Disposes the GeoIP database reader.
        /// </summary>
        public void Dispose()
        {
            reader?.Dispose();
        }

        /// <summary>
        /// Gets geographic location data for an IP address.
        /// </summary>
        /// <param name="ipAddress">The IP address to look up.</param>
        /// <returns>Geographic location data if found, null otherwise.</returns>
        [SuppressMessage("Design", "CA1031:Do not catch general exception types", Justification = "Lookup failures should not crash request handling")]
        internal GeoLocationData? GetLocation(string ipAddress)
        {
            if (!isEnabled || reader is null)
            {
                return null;
            }

            if (string.IsNullOrEmpty(ipAddress))
            {
                return null;
            }

            try
            {
                // Parse IP address
                if (!IPAddress.TryParse(ipAddress, out IPAddress? parsedIp))
                {
                    return null;
                }

                // Skip private/loopback IPs (no GeoIP data available)
                if (IsPrivateOrLoopback(parsedIp))
                {
                    return null;
                }

                // Perform GeoIP lookup
                var response = reader.City(parsedIp);

                return new GeoLocationData
                {
                    CountryCode = response.Country.IsoCode,
                    CountryName = response.Country.Name,
                    City = response.City.Name,
                    Region = response.MostSpecificSubdivision.Name,
                    RegionCode = response.MostSpecificSubdivision.IsoCode,
                    PostalCode = response.Postal.Code,
                    Latitude = response.Location.Latitude,
                    Longitude = response.Location.Longitude,
                    TimeZone = response.Location.TimeZone,
                    Continent = response.Continent.Name,
                    ContinentCode = response.Continent.Code,
                };
            }
            catch (AddressNotFoundException)
            {
                // IP not found in database (rare, but valid case)
                return null;
            }
            catch (GeoIP2Exception ex)
            {
                LogGeoIpLookupFailedAction(logger, ipAddress, ex);
                return null;
            }
            catch (Exception ex)
            {
                LogGeoIpUnexpectedErrorAction(logger, ipAddress, ex);
                return null;
            }
        }

        /// <summary>
        /// Checks if an IP address is private or loopback (no GeoIP data available).
        /// </summary>
        /// <param name="ipAddress">The IP address to check.</param>
        /// <returns>True if private or loopback, false otherwise.</returns>
        private static bool IsPrivateOrLoopback(IPAddress ipAddress)
        {
            // IPv4 loopback
            if (IPAddress.IsLoopback(ipAddress))
            {
                return true;
            }

            byte[] bytes = ipAddress.GetAddressBytes();

            // IPv4 private ranges
            if (bytes.Length == 4)
            {
                return bytes[0] == 10 || // 10.0.0.0/8
                       (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) || // 172.16.0.0/12
                       (bytes[0] == 192 && bytes[1] == 168); // 192.168.0.0/16
            }

            // IPv6 private ranges (simplified check)
            if (bytes.Length == 16)
            {
                return bytes[0] == 0xfc || bytes[0] == 0xfd; // fc00::/7 (unique local)
            }

            return false;
        }
    }
}
