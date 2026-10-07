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
    [Migration("20261009100000_AddEmailChange")]
    public partial class AddEmailChange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NewEmailHash",
                table: "AccountSecurityEvents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OldEmailHash",
                table: "AccountSecurityEvents",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EmailChangeRestores",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    OldEmail = table.Column<string>(type: "text", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RestoreUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailChangeRestores", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PendingEmailChanges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    NewEmail = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PendingEmailChanges", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailChangeRestores_UserId_RestoreUntil",
                table: "EmailChangeRestores",
                columns: new[] { "UserId", "RestoreUntil" });

            migrationBuilder.CreateIndex(
                name: "IX_PendingEmailChanges_ExpiresAt",
                table: "PendingEmailChanges",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_PendingEmailChanges_UserId",
                table: "PendingEmailChanges",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailChangeRestores");

            migrationBuilder.DropTable(
                name: "PendingEmailChanges");

            migrationBuilder.DropColumn(
                name: "NewEmailHash",
                table: "AccountSecurityEvents");

            migrationBuilder.DropColumn(
                name: "OldEmailHash",
                table: "AccountSecurityEvents");
        }
    }
}
