using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AccountService.Migrations
{
    /// <summary>
    /// Changes the column default to false (#783). Resets every stored true to false, because the
    /// box was pre-ticked and a stored true is not proof of consent. Down() restores the default only.
    /// Down() cannot restore the old per-row values.
    /// </summary>
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261012100001_DefaultEmailNotificationsOff")]
    public partial class DefaultEmailNotificationsOff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<bool>(
                name: "EmailNotificationsEnabled",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "boolean",
                oldDefaultValue: true);

            migrationBuilder.Sql(
                "UPDATE \"AspNetUsers\" SET \"EmailNotificationsEnabled\" = FALSE WHERE \"EmailNotificationsEnabled\" = TRUE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<bool>(
                name: "EmailNotificationsEnabled",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: true,
                oldClrType: typeof(bool),
                oldType: "boolean",
                oldDefaultValue: false);
        }
    }
}
