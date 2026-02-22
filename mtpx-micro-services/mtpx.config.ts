/**
 * Multpex CLI project configuration for mtpx-micro-services.
 *
 * Notes:
 * - db:generate / db:push use schemaFile/output/url.
 * - db:migrate uses migrationsPath and auto-syncs generated types after success.
 * - tenantSelector is used by mtpx db:migrate --all-tenants.
 */
import { env, parseCsv } from "@multpex/typescript-sdk";

export default {
  name: "mtpx-micro-services",

  database: {
    // Introspection target (db:generate)
    url: env.string(
      "DATABASE_URL",
      "postgresql://multpex:multpex_secret@localhost:5432/multpex",
    ),
    schema: "public",
    schemaFile: "./src/db/schema.ts",
    output: "./src/db/generated-types.ts",
    include: ["*"],
    exclude: ["_prisma_migrations", "schema_migrations", "_migrations"],

    // CLI migration source (db:migrate)
    migrationsPath: "./migrations",
    dialect: "postgresql",
    migrationTableName: "_migrations",
    syncAfterMigrate: true,

    // Multi-tenant fan-out selector for: mtpx db:migrate ... --all-tenants
    tenantSelector: {
      namespace: env.string("LINKD_KEYSTORE_NAMESPACE", "default"),
      server: env.string("MTPX_DB_SERVER", "local-pg"),
      include: (() => {
        const include = parseCsv(env.string("MTPX_TENANT_DATABASES_INCLUDE"));
        return include.length > 0 ? include : ["local-pg-*"];
      })(),
      exclude: parseCsv(env.string("MTPX_TENANT_DATABASES_EXCLUDE")),
    },
  },

  // Socket used by CLI commands that talk to linkd.
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },

  dev: {
    entry: "src/main.ts",
    watch: ["src"],
  },
};
