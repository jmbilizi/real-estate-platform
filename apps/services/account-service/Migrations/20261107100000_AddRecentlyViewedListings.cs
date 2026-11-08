using System;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261107100000_AddRecentlyViewedListings")]
    public partial class AddRecentlyViewedListings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecentlyViewedListings",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    ListingId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ViewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecentlyViewedListings", x => new { x.UserId, x.ListingId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecentlyViewedListings_UserId_ViewedAt",
                table: "RecentlyViewedListings",
                columns: new[] { "UserId", "ViewedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecentlyViewedListings");
        }
    }
}
