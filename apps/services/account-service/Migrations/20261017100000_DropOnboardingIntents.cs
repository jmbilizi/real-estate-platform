using System.Collections.Generic;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261017100000_DropOnboardingIntents")]
    public partial class DropOnboardingIntents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // No product surface ever wrote this column (#41). Property-service owns the
            // replacement, "What I'm looking for" (#768).
            migrationBuilder.DropColumn(
                name: "Intents",
                table: "AspNetUsers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "Intents",
                table: "AspNetUsers",
                type: "text[]",
                nullable: false,
                defaultValueSql: "ARRAY[]::text[]");
        }
    }
}
