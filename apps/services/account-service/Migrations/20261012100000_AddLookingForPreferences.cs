using System;
using System.Collections.Generic;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261012100000_AddLookingForPreferences")]
    public partial class AddLookingForPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The table is new and empty, and the key index is created with it. A plain CREATE is
            // safe: no writer waits on a lock. CONCURRENTLY is for an index on a populated table.
            migrationBuilder.CreateTable(
                name: "LookingForPreferences",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Intent = table.Column<string>(type: "text", nullable: false),
                    PlacesJson = table.Column<string>(type: "jsonb", nullable: false),
                    PriceMin = table.Column<int>(type: "integer", nullable: true),
                    PriceMax = table.Column<int>(type: "integer", nullable: true),
                    BedsMin = table.Column<int>(type: "integer", nullable: true),
                    BathsMin = table.Column<int>(type: "integer", nullable: true),
                    HomeTypes = table.Column<List<string>>(type: "text[]", nullable: false),
                    WhenStart = table.Column<DateOnly>(type: "date", nullable: true),
                    WhenEnd = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LookingForPreferences", x => new { x.UserId, x.Id });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LookingForPreferences");
        }
    }
}
