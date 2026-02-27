import {
  createApp,
  StartupErrorHandler,
} from "@multpex/sdk-typescript";

interface ItemRow extends Record<string, unknown> {
  id: string;
  name: string;
  quantity: number;
  updated_at?: string;
}

function inferDbServerNameFromDatabaseName(databaseName: string): string | null {
  const match = /^(?<provider>[a-z0-9]+)-(?<serverType>mysql|pg|postgres)-[a-z0-9]+(?:-[a-z0-9]+)*$/i.exec(
    databaseName.trim(),
  );
  if (!match?.groups) {
    return null;
  }

  const provider = String(match.groups.provider).toLowerCase();
  const serverType = String(match.groups.serverType).toLowerCase();
  const normalizedType = serverType === "postgres" ? "pg" : serverType;
  return `${provider}-${normalizedType}`;
}

const app = createApp({
  name: "db-env-selector",
  namespace: "db-env-selector",
  database: {
    allowRaw: true,
    multiTenant: mtpx.env.bool("MTPX_DB_MULTI_TENANT", true),
  },
  logging: {
    level: "info",
    console: true,
    file: false,
  },
});

app.afterStart(async (ctx) => {
  let exitCode = 0;
  const databaseName = mtpx.env.required("LINKD_DATABASE_NAME");

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
    const message = error instanceof Error ? error.message : String(error);
    const serverName = inferDbServerNameFromDatabaseName(databaseName);
    const provisioningHint = serverName
      ? [
          `Database '${databaseName}' não está registrado no linkd/keystore.`,
          "Provisione antes de rodar o exemplo:",
          `  mtpx db server add ${serverName} --dialect postgresql --host localhost --port 5432 --admin-user multpex --admin-password multpex`,
          `  mtpx db database create ${databaseName} --server ${serverName}`,
          "Depois aguarde o watcher do linkd sincronizar (intervalo padrão: até 5s).",
        ].join("\n")
      : undefined;

    app.logger.error("Falha ao executar fluxo SQL", {
      databaseName,
      error: message,
      hint: message.includes("Database not found") ? provisioningHint : undefined,
    });
  } finally {
    await app.stop();
    process.exit(exitCode);
  }
});

await app.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: mtpx.env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);

app.logger.info("db-env-selector iniciado", {
  databaseName: mtpx.env.string("LINKD_DATABASE_NAME"),
});
