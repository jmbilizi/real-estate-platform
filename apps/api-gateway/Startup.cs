// <copyright file="Startup.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Diagnostics.CodeAnalysis;
using System.Text;
using ApiGateway.Extensions;
using Ocelot.DependencyInjection;
using Ocelot.Middleware;

namespace ApiGateway
{
    /// <summary>
    /// Startup class for configuring the API Gateway services and middleware.
    /// </summary>
    [SuppressMessage("Performance", "CA1515:Consider making public types internal", Justification = "Used by ASP.NET Core via reflection")]
    public class Startup
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="Startup"/> class.
        /// </summary>
        /// <param name="configuration">The application configuration.</param>
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        /// <summary>
        /// Gets the application configuration.
        /// </summary>
        public IConfiguration Configuration { get; }

        /// <summary>
        /// Configures the application services.
        /// </summary>
        /// <param name="services">The service collection.</param>
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddCors(options =>
            {
                options.AddPolicy(
                    "CORSPolicy",
                    builder => builder
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials()
                        .SetIsOriginAllowed((hosts) => true));
            });

            services.AddControllers();

            // Add health checks
            services.AddHealthChecks();

            services.AddEndpointsApiExplorer();

            string serviceRoutesFolderPath = "Configuration/Routes";

            string baseOcelotConfigurationFilePath = "Configuration/Ocelot.Settings.json";

            string ocelotConfigurationJsonString = JsonMerger.MergeJsonRoutesFolderWithTheBaseOcelotConfigurationSettings(serviceRoutesFolderPath, baseOcelotConfigurationFilePath);

            MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(ocelotConfigurationJsonString));

            IConfigurationRoot configuration = new ConfigurationBuilder().AddJsonStream(stream).Build();

            services.AddOcelot(configuration);

            // Add services for Swagger generation
            services.AddSwaggerGen();

            services.AddSwaggerForOcelot(configuration, option =>
            {
                option.GenerateDocsForGatewayItSelf = true;
            });
        }

        /// <summary>
        /// Configures the HTTP request pipeline.
        /// </summary>
        /// <param name="app">The application builder.</param>
        /// <param name="env">The web host environment.</param>
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            app.UseCors("CORSPolicy");

            app.UseHttpsRedirection();

            app.UseRouting();

            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapGet("/", context =>
                {
                    context.Response.Redirect("/swagger", permanent: false);
                    return Task.CompletedTask;
                });

                endpoints.MapControllers();

                // Health check endpoints (must be before Ocelot middleware)
                endpoints.MapHealthChecks("/health/live");
                endpoints.MapHealthChecks("/health/ready");
            });

            app.UseSwaggerForOcelotUI(option =>
            {
                option.PathToSwaggerGenerator = "/swagger/docs";
            });

            app.UseOcelot().Wait();
        }
    }
}
