import {
  createApp,
  isValidDatabaseName,
  resolveDatabaseNameFromEnv,
  setupGracefulShutdown,
  type Context,
  type ServiceContext,
} from "@multpex/typescript-sdk";

const databaseName = resolveDatabaseNameFromEnv();

if (!databaseName) {
  throw new Error(
    "Defina MULTPEX_DATABASE_NAME (ou MTPX_DATABASE_NAME / MULTPEX_DATABASE / DATABASE_NAME) com o nome do database.",
  );
}

if (!isValidDatabaseName(databaseName)) {
  throw new Error(
    `Database inválido: '${databaseName}'. Use <provider>-<db-server-type>-<database-name> (ex: rds-mysql-voucher, k8s-pg-voucher, local-pg-voucher, docker-mysql-voucher).`,
  );
}

const databaseServerName = process.env.MULTPEX_DB_SERVER ?? "default";
const databaseCredentialName =
  process.env.MULTPEX_DATABASE_KEYSTORE_NAME ?? `${databaseServerName}:${databaseName}`;

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

app.beforeStart(async () => {
  const credential = await app.keystore.get("database", databaseCredentialName);
  const credentialDatabase = String(credential.database ?? "");

  if (!credentialDatabase) {
    throw new Error(
      `Credencial 'database/${databaseCredentialName}' não possui campo 'database' no keystore.`,
    );
  }

  if (credentialDatabase !== databaseName) {
    throw new Error(
      `Mismatch de database: env='${databaseName}' keystore='${credentialDatabase}' (credential: database/${databaseCredentialName}).`,
    );
  }

  app.logger.info("Database selecionado por env e validado no keystore", {
    databaseName,
    databaseCredentialName,
  });
});

app.action(
  "db-health",
  { route: "/db-env-selector/db-health", method: "GET" },
  async (ctx: Context) => {
    const serviceCtx = ctx as ServiceContext;

    if (!serviceCtx.db) {
      return { ok: false, error: "ctx.db indisponível" };
    }

    const ping = await serviceCtx.db.raw<{ ok: number }>({
      sql: "SELECT 1 AS ok",
      bindings: [],
    });

    return {
      ok: true,
      selectedDatabase: databaseName,
      keystoreCredential: databaseCredentialName,
      ping: ping[0]?.ok ?? 0,
    };
  },
);

await app.start();
setupGracefulShutdown(app);

app.logger.info("db-env-selector iniciado", {
  databaseName,
  databaseCredentialName,
});
