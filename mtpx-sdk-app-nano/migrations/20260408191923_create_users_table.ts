/**
 * Migration: 20260408191923_create_users_table
 * 
 * Created at: 2026-04-08T22:19:23.727Z
 */

import { Schema } from "@linkd/sdk-typescript";

export const migration = {
  name: "20260408191923_create_users_table",
  version: "20260408191923",

  /**
   * Run the migration (apply changes).
   */
  up(schema: Schema): void {
    schema.createTable("users", (table) => {
      table.uuid("id").primary();
      table.string("name", 255).notNullable();
      table.string("email", 255).notNullable().unique();
      table.boolean("active").default(true);
      table.timestamp("created_at").nullable().default("CURRENT_TIMESTAMP");
      table.timestamp("updated_at").nullable().default("CURRENT_TIMESTAMP");
    });
  },

  /**
   * Reverse the migration (rollback changes).
   */
  down(schema: Schema): void {
    schema.dropTable("users");
  },
};

export default migration;
