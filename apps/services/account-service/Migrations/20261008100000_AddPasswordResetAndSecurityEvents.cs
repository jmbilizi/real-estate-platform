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
    [Migration("20261008100000_AddPasswordResetAndSecurityEvents")]
    public partial class AddPasswordResetAndSecurityEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountSecurityEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()"),
                    ClientAddressHash = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountSecurityEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PasswordResetProofs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    ProofHash = table.Column<byte[]>(type: "bytea", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordResetProofs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountSecurityEvents_UserId_OccurredAt",
                table: "AccountSecurityEvents",
                columns: new[] { "UserId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PasswordResetProofs_Email",
                table: "PasswordResetProofs",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PasswordResetProofs_ExpiresAt",
                table: "PasswordResetProofs",
                column: "ExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AccountSecurityEvents");

            migrationBuilder.DropTable(
                name: "PasswordResetProofs");
        }
    }
}
