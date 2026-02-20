/**
 * Multpex Configuration
 * 
 * This file configures the Multpex CLI for this project.
 */

export default {
  name: "moleculer-demo",

  database: {
    // Database URL for introspection (used by db:generate)
    url: process.env.DATABASE_URL || "postgresql://multpex:multpex_secret@localhost:5432/multpex",
    
    // Schema definition file (used by db:push)
    schemaFile: "./src/db/schema.ts",
    
    // Schema to introspect
    schema: "public",
    
    // Output path for generated types (used by db:generate)
    output: "./src/db/generated-types.ts",
    
    // Tables to include (glob patterns)
    include: ["*"],
    
    // Tables to exclude
    exclude: ["_prisma_migrations", "schema_migrations"],
  },

  sidecar: {
    socket: process.env.LINKD_SOCKET || "/tmp/linkd.sock",
  },

  dev: {
    entry: "src/main.ts",
    watch: ["src"],
  },
};
