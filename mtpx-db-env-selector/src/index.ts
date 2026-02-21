import {
  createApp,
  isValidDatabaseName,
  resolveDatabaseNameFromEnv,
  setupGracefulShutdown,
} from "@multpex/typescript-sdk";

const databaseName = resolveDatabaseNameFromEnv();

if (!databaseName) {
  throw new Error(
    "Defina MULTPEX_DATABASE_NAME (ou MTPX_DATABASE_NAME / MULTPEX_DATABASE / DATABASE_NAME) com o nome do database.",
  );
}

if (!isValidDatabaseName(databaseName)) {
  throw new Error(
    `Database inválido: '${databaseName}'. Use <provider>-<db-server-type>-<database-name> (ex: docker-pg-test, k8s-pg-voucher, local-pg-voucher, docker-mysql-voucher).`,
  );
}

const app = createApp({
  name: "db-env-selector",
  namespace: "db-env-selector",
  database: {
    allowRaw: true,
    defaultDatabase: databaseName,
  },
  logging: {
    level: "info",
    console: true,
    file: false,
  },
});

app.afterStart(async (ctx) => {
  let exitCode = 0;

  try {
    const database = ctx.db;

    if (!database) {
      throw new Error("Database client indisponível no contexto de lifecycle.");
    }

    const tableName = "sample_items";
    const itemId = "item-1";

    await database.raw(
      `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          quantity INTEGER NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      [],
    );

    const table = database.table<{
      id: string;
      name: string;
      quantity: number;
      updated_at?: string;
    }>(tableName);

    const inserted = await table.insertOrNull(
      { id: itemId, name: "sample-upsert", quantity: 42 },
      "id",
    );

    if (!inserted) {
      await table.whereEquals("id", itemId).update({
        name: "sample-upsert",
        quantity: 42,
      });
    }

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

await app.start();
setupGracefulShutdown(app);

app.logger.info("db-env-selector iniciado", {
  databaseName,
});
