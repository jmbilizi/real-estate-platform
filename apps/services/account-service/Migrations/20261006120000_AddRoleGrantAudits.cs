using System;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261006120000_AddRoleGrantAudits")]
    public partial class AddRoleGrantAudits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RoleGrantAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GrantorUserId = table.Column<string>(type: "text", nullable: false),
                    GranteeUserId = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "NOW()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoleGrantAudits", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RoleGrantAudits_GranteeUserId",
                table: "RoleGrantAudits",
                column: "GranteeUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RoleGrantAudits");
        }
    }
}
