import {
  createService,
  decodeJwtPayload,
  env,
  requestLogger,
  StartupErrorHandler,
  z,
  type TypedServiceContext,
} from "@multpex/sdk-typescript";

interface CurrentDatabaseRow {
  current_database: string;
}

interface NoteRow extends Record<string, unknown> {
  id: string;
  message: string;
  created_by: string;
  realm: string;
  db_tenant: string;
  created_at: string;
}

interface ExampleSchema {
  tenant_notes: NoteRow;
  [key: string]: Record<string, unknown>;
}

type AppContext<TBody = unknown> = TypedServiceContext<ExampleSchema, TBody>;

const KNOWN_REALMS = ["realm1", "realm2"] as const;

const loginSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
});

const noteSchema = z.object({
  message: z.string().min(1, "message is required").max(400),
});

const service = createService<ExampleSchema>({
  name: "keycloak-multi-tenant-routing",
  namespace: env.string("LINKD_NAMESPACE", "tenant-routing-demo"),
  auth: {
    enabled: true,
    realm: env.string("DEFAULT_AUTH_REALM", "realm1"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
    knownRealms: [...KNOWN_REALMS],
  },
  database: {
    allowRaw: true,
    multiTenant: true,
  },
  logging: {
    level: env.bool("DEBUG") ? "debug" : "info",
    pretty: true,
    file: false,
  },
});

service.use(requestLogger());

function requireDb(ctx: AppContext) {
  return ctx.db;
}

function buildTokenPreview(accessToken: string) {
  const claims = decodeJwtPayload(accessToken);
  return {
    iss: claims.iss ?? null,
    azp: claims.azp ?? null,
    tenant: claims.tenant ?? null,
    tenantId: claims.tenant_id ?? null,
    preferredUsername: claims.preferred_username ?? null,
  };
}

function currentUsername(ctx: AppContext): string {
  const preferredUsername = ctx.user?.metadata?.preferred_username;
  if (typeof preferredUsername === "string" && preferredUsername.length > 0) {
    return preferredUsername;
  }

  return ctx.user?.id || "anonymous";
}

async function currentDatabase(ctx: AppContext): Promise<string> {
  const db = requireDb(ctx);
  const rows = await db.raw<CurrentDatabaseRow>(
    "SELECT current_database() AS current_database",
  );
  return rows[0]?.current_database ?? "unknown";
}

async function ensureTenantSchema(ctx: AppContext): Promise<void> {
  const db = requireDb(ctx);

  await db.schema.createTableIfNotExists("tenant_notes", (table) => {
    table.string("id", 64).primary();
    table.string("message", 400).notNullable();
    table.string("created_by", 120).notNullable();
    table.string("realm", 40).notNullable();
    table.string("db_tenant", 80).notNullable();
    table
      .timestamp("created_at")
      .notNullable()
      .default("CURRENT_TIMESTAMP");
  });
}

async function tenantSummary(ctx: AppContext) {
  return {
    host: ctx.header("host") ?? null,
    realm: ctx.tenant.realm,
    realmSource: ctx.tenant.source,
    userTenantId: ctx.user?.tenantId ?? null,
    currentDatabase: await currentDatabase(ctx),
  };
}

service.beforeStart(async () => {
  service.logger.info("Starting Keycloak multi-tenant routing example", {
    knownRealms: KNOWN_REALMS,
    namespace: env.string("LINKD_NAMESPACE", "tenant-routing-demo"),
  });
});

service.afterStart(async () => {
  service.logger.info("Example ready", {
    discoveryRealm1:
      "http://realm1.localhost:3000/tenant-routing/auth/discovery",
    discoveryRealm2:
      "http://realm2.localhost:3000/tenant-routing/auth/discovery",
  });
});

service.action(
  "health",
  {
    route: "/tenant-routing/health",
    method: "GET",
  },
  async () => ({
    status: "ok",
    service: "mtpx-keycloak-multi-tenant-routing",
    knownRealms: KNOWN_REALMS,
    timestamp: new Date().toISOString(),
  }),
);

service.action(
  "auth.discovery",
  {
    route: "/tenant-routing/auth/discovery",
    method: "GET",
  },
  async (ctx: AppContext) => ({
    tenant: {
      realm: ctx.tenant.realm,
      source: ctx.tenant.source,
      host: ctx.header("host") ?? null,
    },
    discovery: await ctx.auth!.getDiscovery(),
  }),
);

service.action(
  "auth.login",
  {
    route: "/tenant-routing/auth/login",
    method: "POST",
    validate: loginSchema,
  },
  async (ctx: AppContext) => {
    const body = ctx.body as z.infer<typeof loginSchema>;
    const result = await ctx.auth!.login(body);

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn,
      tokenType: result.tokenType,
      user: result.user,
      tenant: {
        realm: ctx.tenant.realm,
        source: ctx.tenant.source,
        host: ctx.header("host") ?? null,
      },
      tokenPreview: buildTokenPreview(result.accessToken),
    };
  },
);

service.action(
  "context",
  {
    route: "/tenant-routing/context",
    method: "GET",
    auth: true,
  },
  async (ctx: AppContext) => ({
    tenant: await tenantSummary(ctx),
    user: {
      id: ctx.user?.id ?? null,
      tenantId: ctx.user?.tenantId ?? null,
      roles: ctx.user?.roles ?? [],
      preferredUsername: ctx.user?.metadata?.preferred_username ?? null,
      clientId: ctx.user?.metadata?.client_id ?? null,
    },
  }),
);

service.action(
  "notes.list",
  {
    route: "/tenant-routing/notes",
    method: "GET",
    auth: true,
  },
  async (ctx: AppContext) => {
    await ensureTenantSchema(ctx);

    const db = requireDb(ctx);
    const notes = await db
      .table<NoteRow>("tenant_notes")
      .select("id", "message", "created_by", "realm", "db_tenant", "created_at")
      .orderByField("created_at", "desc")
      .get();

    return {
      tenant: await tenantSummary(ctx),
      total: notes.length,
      notes,
    };
  },
);

service.action(
  "notes.create",
  {
    route: "/tenant-routing/notes",
    method: "POST",
    auth: true,
    validate: noteSchema,
  },
  async (ctx: AppContext) => {
    const body = ctx.body as z.infer<typeof noteSchema>;

    await ensureTenantSchema(ctx);

    const db = requireDb(ctx);
    const note = await db.table<NoteRow>("tenant_notes").insert({
      id: crypto.randomUUID(),
      message: body.message,
      created_by: currentUsername(ctx),
      realm: ctx.tenant.realm,
      db_tenant: ctx.user?.tenantId ?? "unknown",
    });

    return {
      tenant: await tenantSummary(ctx),
      note,
    };
  },
);

service.action(
  "notes.clear",
  {
    route: "/tenant-routing/notes",
    method: "DELETE",
    auth: true,
    roles: ["admin"],
  },
  async (ctx: AppContext) => {
    await ensureTenantSchema(ctx);

    const db = requireDb(ctx);
    const deleted = await db.table<NoteRow>("tenant_notes").delete();

    return {
      tenant: await tenantSummary(ctx),
      deleted,
    };
  },
);

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint:
      env.coalesce("LINKD_CONNECT", "LINKD_URL") || "unix:/tmp/linkd.sock",
    hint: "Ensure linkd TCP auth is using the default 'multpex' realm and refresh the local CLI session with 'mtpx login' after reseeding Keycloak.",
  }),
);
