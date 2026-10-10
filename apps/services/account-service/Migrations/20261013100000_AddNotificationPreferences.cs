using System;
using AccountService.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AccountService.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AccountDbContext))]
    [Migration("20261013100000_AddNotificationPreferences")]
    public partial class AddNotificationPreferences : Migration
    {
        private static readonly string[] AuditIndexColumns = new[] { "AccountId", "OccurredAt" };

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Both tables are new and empty, so a plain CREATE is safe (#694).
            migrationBuilder.CreateTable(
                name: "NotificationPreferences",
                columns: table => new
                {
                    AccountId = table.Column<string>(type: "text", nullable: false),
                    Channel = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    ConsentText = table.Column<string>(type: "text", nullable: true),
                    ConsentedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationPreferences", x => new { x.AccountId, x.Channel, x.Category });
                });

            migrationBuilder.CreateTable(
                name: "NotificationPreferenceAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<string>(type: "text", nullable: false),
                    ActorId = table.Column<string>(type: "text", nullable: true),
                    Channel = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    PreviousEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    ConsentText = table.Column<string>(type: "text", nullable: true),
                    OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationPreferenceAudits", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationPreferenceAudits_AccountId_OccurredAt",
                table: "NotificationPreferenceAudits",
                columns: AuditIndexColumns);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotificationPreferenceAudits");

            migrationBuilder.DropTable(
                name: "NotificationPreferences");
        }
    }
}
