import {
  createApp,
  StartupErrorHandler,
  env,
} from "@multpex/sdk-typescript";

interface ItemRow extends Record<string, unknown> {
  id: string;
  name: string;
  quantity: number;
  updated_at?: string;
}

const app = createApp({
  name: "db-env-selector",
  namespace: "db-env-selector",
  database: {
    allowRaw: true,
  },
  logging: {
    level: "info",
    console: true,
    file: false,
  },
});

app.afterStart(async (ctx) => {
  let exitCode = 0;
  const databaseName = ctx.env.required("LINKD_DATABASE_NAME");

  try {
    const database = ctx.db;

    if (!database) {
      throw new Error("Database client indisponível no contexto de lifecycle.");
    }

    const tableName = "sample_items";
    const itemId = "item-1";

    // Schema builder API — identifiers são auto-quoted, imune a SQL injection
    await database.schema.createTableIfNotExists(tableName, (t) => {
      t.string("id", 64).primary();
      t.string("name", 120).notNullable();
      t.integer("quantity").notNullable();
      t.timestamp("updated_at").notNullable().default("CURRENT_TIMESTAMP");
    });

    const table = database.table<ItemRow>(tableName);

    await table.upsert(
      { id: itemId, name: "sample-upsert", quantity: 42 },
      "id",
    );

    const selected = await table
      .select("id", "name", "quantity")
      .whereEquals("id", itemId)
      .first();

    await table.whereEquals("id", itemId).delete();

    app.logger.info("Fluxo SQL concluído", {
      databaseName,
      tableName,
      selected,
    });
  } catch (error) {
    exitCode = 1;
    app.logger.error("Falha ao executar fluxo SQL", {
      databaseName,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await app.stop();
    process.exit(exitCode);
  }
});

await app.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);

app.logger.info("db-env-selector iniciado", {
  databaseName: app.env.string("LINKD_DATABASE_NAME"),
});
