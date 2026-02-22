/**
 * Multpex CLI project configuration for mtpx-micro-services.
 *
 * Notes:
 * - db:generate / db:push use schemaFile/output/url.
 * - db:migrate uses migrationsPath and can fan out with --all-tenants.
 * - tenantSelector is used by mtpx db:migrate --all-tenants.
 */

function parseCsv(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const tenantInclude = parseCsv(process.env.MTPX_TENANT_DATABASES_INCLUDE);
const tenantExclude = parseCsv(process.env.MTPX_TENANT_DATABASES_EXCLUDE);

export default {
  name: "mtpx-micro-services",

  database: {
    // Introspection target (db:generate)
    url:
      process.env.DATABASE_URL
      || "postgresql://multpex:multpex_secret@localhost:5432/multpex",
    schema: "public",
    schemaFile: "./src/db/schema.ts",
    output: "./src/db/generated-types.ts",
    include: ["*"],
    exclude: ["_prisma_migrations", "schema_migrations", "_migrations"],

    // CLI migration source (db:migrate)
    migrationsPath: "./migrations",
    dialect: "postgresql",
    migrationTableName: "_migrations",

    // Multi-tenant fan-out selector for: mtpx db:migrate ... --all-tenants
    tenantSelector: {
      namespace: process.env.LINKD_KEYSTORE_NAMESPACE || "default",
      server: process.env.MTPX_DB_SERVER || "local-pg",
      include: tenantInclude.length > 0 ? tenantInclude : ["local-pg-*"],
      exclude: tenantExclude,
    },
  },

  // Current CLI key for sidecar socket path.
  linkd: {
    socket: process.env.LINKD_SOCKET || "/tmp/linkd.sock",
  },

  dev: {
    entry: "src/main.ts",
    watch: ["src"],
  },
};
