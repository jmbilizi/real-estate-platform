using System;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#pragma warning disable CA1861

#nullable disable

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261007120000_AddEmailCodes")]
    public partial class AddEmailCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailCodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: false),
                    Purpose = table.Column<string>(type: "text", nullable: false),
                    CodeHash = table.Column<byte[]>(type: "bytea", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UserId = table.Column<string>(type: "text", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailCodes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmailCodeThrottles",
                columns: table => new
                {
                    Email = table.Column<string>(type: "text", nullable: false),
                    Purpose = table.Column<string>(type: "text", nullable: false),
                    FailedAttempts = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LockedUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailCodeThrottles", x => new { x.Email, x.Purpose });
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailCodes_Email_Purpose_CreatedAt",
                table: "EmailCodes",
                columns: new[] { "Email", "Purpose", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailCodes_ExpiresAt",
                table: "EmailCodes",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_EmailCodeThrottles_UpdatedAt",
                table: "EmailCodeThrottles",
                column: "UpdatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailCodes");

            migrationBuilder.DropTable(
                name: "EmailCodeThrottles");
        }
    }
}
