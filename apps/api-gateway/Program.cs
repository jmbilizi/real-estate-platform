// <copyright file="Program.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>
// Entry point for the API Gateway.

namespace ApiGateway
{
    /// <summary>
    /// The main entry point for the API Gateway application.
    /// </summary>
    internal static class Program
    {
        /// <summary>
        /// The main entry point for the application.
        /// </summary>
        /// <param name="args">Command-line arguments.</param>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public static async Task Main(string[] args)
        {
            var host = CreateHostBuilder(args).Build();

            // We can do something else here in between before the app runs
            await host.RunAsync().ConfigureAwait(false);
        }

        /// <summary>
        /// Creates and configures the host builder.
        /// </summary>
        /// <param name="args">Command-line arguments.</param>
        /// <returns>A configured <see cref="IHostBuilder"/>.</returns>
        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                });
    }
}
