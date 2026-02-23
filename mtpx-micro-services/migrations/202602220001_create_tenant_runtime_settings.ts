/**
 * Migration: create tenant runtime settings table.
 *
 * This migration is used by `mtpx db:migrate`.
 * Run for all tenant databases with:
 *   mtpx db:migrate up --all-tenants
 */

import { Schema } from "@multpex/sdk-typescript";

export const migration = {
  name: "202602220001_create_tenant_runtime_settings",
  version: "202602220001",

  up(schema: Schema): void {
    schema.createTable("tenant_runtime_settings", (table) => {
      table.uuid("id").primary().defaultRandom();
      table.string("setting_key", 120).notNullable();
      table.text("setting_value").notNullable();
      table.string("scope", 64).notNullable().default("global");
      table.timestamps();
    });
  },

  down(schema: Schema): void {
    schema.dropTable("tenant_runtime_settings");
  },
};

export default migration;
