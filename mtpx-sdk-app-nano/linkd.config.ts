export default {
  name: "mtpx-sdk-app",

  database: {
    schemaFile: "./src/db/schema.ts",
    output: "./src/db/schema.ts",
    migrationsPath: "./migrations",
    syncAfterMigrate: true,
    include: ["*"],
    exclude: ["_migrations"],
  },

  linkd: {
    connect: "tcp://localhost:9999",
    database: "mtpx_sdk_app",
  },

  dev: {
    entry: "src/index.ts",
    port: 3000,
    watch: ["src"],
  },
};
