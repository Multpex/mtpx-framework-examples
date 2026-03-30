/**
 * mtpx-runtime-db — Acesso a banco fora de request HTTP (RFC 0005)
 *
 *   1. Detached DB  — createRuntimeContext() antes do service subir (migrations)
 *   2. Runtime DB   — ctx.db / service.runtime.db em lifecycle hooks
 *   3. Request DB   — ctx.db em handlers HTTP (request-scoped)
 */

import {
  ConflictError,
  createService,
  createRuntimeContext,
  StartupErrorHandler,
  JobHandler,
  type TypedServiceContext,
  env,
  z,
} from "@linkd/sdk-typescript";

import type { Schema } from "./db/schema.js";
import { migrations } from "./db/migrations.js";

type Ctx = TypedServiceContext<Schema>;

// ============================================================================
// Service
// ============================================================================

const DATABASE_NAME = env.string("LINKD_DATABASE_NAME", "docker-pg-test");
const LINKD_ENDPOINT = env.coalesce("LINKD_CONNECT", "LINKD_URL") ?? "unix:/tmp/linkd.sock";
const DB_POOL_ENABLED = env.bool("LINKD_DB_POOL_ENABLED", true);
const DB_POOL_SIZE = Math.max(1, Math.trunc(env.number("LINKD_DB_POOL_SIZE", 3)));
const HTTP_CACHE_ENABLED = env.bool("LINKD_HTTP_CACHE_ENABLED", true);
const HTTP_CACHE_TTL_SECONDS = Math.max(
  1,
  Math.trunc(env.number("LINKD_HTTP_CACHE_TTL_SECONDS", 300)),
);
const HTTP_CACHE_DETAIL_TTL_SECONDS = Math.max(
  1,
  Math.trunc(env.number("LINKD_HTTP_CACHE_DETAIL_TTL_SECONDS", HTTP_CACHE_TTL_SECONDS)),
);
const HTTP_CACHE_MAX_ENTRIES = Math.max(
  1,
  Math.trunc(env.number("LINKD_HTTP_CACHE_MAX_ENTRIES", 1000)),
);

// createService<Schema>() é necessário para ctx.db ser TypedDatabase<Schema>.
// Use createApp() quando não precisar de ctx.db tipado nos handlers.
const service = createService<Schema>({
  name: "runtime-db-demo",
  namespace: "default",
  pool: {
    enabled: DB_POOL_ENABLED,
    dbPoolSize: DB_POOL_SIZE,
  },
  database: {
    defaultDatabase: DATABASE_NAME,
    allowRaw: true,
  },
  queue: { defaultQueue: "runtime-db-demo" },
  logging: { level: "info", console: true },
});

// ============================================================================
// Job Handler — acesso ao Runtime DB via service.runtime.db
//
// Jobs rodam fora de request, em system scope (sem user/tenant).
// A referência a `service` é válida porque jobs só executam após service.start().
// ============================================================================

class CreateSystemNote extends JobHandler<{ title: string; body?: string }, { ok: boolean }> {
  async handle() {
    await service.runtime?.db?.notes.insert({
      title: this.data.title,
      body: this.data.body ?? "",
      author: "system",
    });
    return { ok: true };
  }
}

service.queue.handler(CreateSystemNote);

// ============================================================================
// Lifecycle — Modo 1: Detached DB (createRuntimeContext, antes de start())
//
// Conexão independente, sem service registrado. Usada aqui para migrations.
// close() é obrigatório ao terminar.
// ============================================================================

async function runMigrations(): Promise<void> {
  const runtime = await createRuntimeContext({
    connect: LINKD_ENDPOINT,
    name: "runtime-db-demo:bootstrap",
    database: DATABASE_NAME,
    allowRaw: true,
  });

  try {
    if (!runtime.rawDb.runMigrations) return;
    const results = await runtime.rawDb.runMigrations({
      migrations,
      direction: "up",
      dry_run: false,
      database: DATABASE_NAME,
    });
    const ok = results.filter((r) => r.success).length;
    service.logger.info(`Migrations: ${ok}/${results.length} aplicada(s)`);
  } finally {
    await runtime.close();
  }
}

// ============================================================================
// Lifecycle — Modo 2: Runtime DB (ctx.db / service.runtime.db fora de request)
// ============================================================================

// afterConnect: DB disponível, service ainda não registrado no sidecar.
// Ideal para seed e preload antes das rotas ficarem ativas.
service.afterConnect(async (ctx) => {
  await ctx.db!.users.upsert(
    { id: "00000000-0000-0000-0000-000000000001", name: "Admin", email: "admin@example.com", role: "admin" },
    "id",
  );
  service.logger.info("Usuário padrão garantido via Runtime DB (afterConnect).");
});

// afterStart: service registrado, rotas ativas. service.runtime.db disponível.
service.afterStart(async () => {
  if (HTTP_CACHE_ENABLED) {
    await service.cache({
      defaultPolicy: {
        enabled: true,
        defaultTtlSeconds: HTTP_CACHE_TTL_SECONDS,
        defaultMethods: ["GET"],
        addCacheHeaders: true,
      },
      endpoints: [
        {
          action: "list-users",
          route: "/users",
          ttlSeconds: HTTP_CACHE_TTL_SECONDS,
        },
        {
          action: "list-notes",
          route: "/notes",
          ttlSeconds: HTTP_CACHE_TTL_SECONDS,
        },
        {
          action: "get-note",
          route: "/notes/:id",
          ttlSeconds: HTTP_CACHE_DETAIL_TTL_SECONDS,
        },
      ],
      maxEntries: HTTP_CACHE_MAX_ENTRIES,
    });
  }

  const users = await service.runtime!.db.users.get();
  service.logger.info(`${users.length} usuário(s) carregado(s) via service.runtime.db`);
  service.logger.info(
    `Perf config: dbPool=${DB_POOL_ENABLED ? `on (${DB_POOL_SIZE})` : "off"}, cache=${HTTP_CACHE_ENABLED ? `on (${HTTP_CACHE_TTL_SECONDS}s)` : "off"}`,
  );
});

// beforeStop: persiste nota de encerramento antes do serviço sair.
service.beforeStop(async (ctx) => {
  await ctx.db?.notes.insert({ title: "Serviço encerrado", body: "", author: "system" });
  service.invalidateCache({ action: "list-notes" });
});

// ============================================================================
// HTTP Handlers — Modo 3: Request DB (ctx.db com escopo de request)
// ============================================================================

service.action("list-users", { route: "/users", method: "GET" }, async (ctx: Ctx) => {
  return { users: await ctx.db.users.orderByField("created_at", "desc").get() };
});

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  role: z.string().min(1).max(50).default("user"),
});

service.action(
  "create-user",
  { route: "/users", method: "POST", validate: CreateUserSchema },
  async (ctx: Ctx) => {
    const body = CreateUserSchema.parse(ctx.body);
    const user = await ctx.db.users.insertOrNull(body, "email");

    if (!user) {
      throw ConflictError.duplicate("User", "email", body.email);
    }

    service.invalidateCache({ action: "list-users" });

    return user;
  },
);

const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  author: z.string().default("anonymous"),
});

service.action("list-notes", { route: "/notes", method: "GET" }, async (ctx: Ctx) => {
  return { notes: await ctx.db.notes.orderByField("created_at", "desc").get() };
});

service.action(
  "create-note",
  { route: "/notes", method: "POST", validate: CreateNoteSchema },
  async (ctx: Ctx) => {
    const body = CreateNoteSchema.parse(ctx.body);
    const note = await ctx.db.notes.insert(body);
    service.invalidateCache({ action: "list-notes" });
    return note;
  },
);

service.action("get-note", { route: "/notes/:id", method: "GET" }, async (ctx: Ctx) => {
  const note = await ctx.db.notes.whereEquals("id", ctx.params.id).first();
  return note ?? { error: "Not found", statusCode: 404 };
});

service.action("delete-note", { route: "/notes/:id", method: "DELETE" }, async (ctx: Ctx) => {
  const deleted = await ctx.db.notes.whereEquals("id", ctx.params.id).delete();

  if (deleted) {
    service.invalidateCache({ action: "list-notes" });
    service.invalidateCache({ action: "get-note" });
    return { ok: true };
  }

  return { error: "Not found", statusCode: 404 };
});

// ============================================================================
// Startup
// ============================================================================

// Modo 1: Detached DB — migrations antes de conectar o service
await runMigrations().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: LINKD_ENDPOINT,
    hint: `Inicie o Linkd e garanta que o database '${DATABASE_NAME}' está provisionado.`,
  }),
);

// Modos 2 e 3: service.start() → afterConnect → afterStart → rotas ativas
await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: LINKD_ENDPOINT,
    hint: `Inicie o Linkd e garanta que o database '${DATABASE_NAME}' está provisionado.`,
  }),
);
