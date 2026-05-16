import {
  createService,
  decodeJwtPayload,
  env,
  requestLogger,
  Schema,
  StartupErrorHandler,
  z,
  type TypedServiceContext,
} from "@linkd/sdk-typescript";

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

// Declarative table definition — the SDK auto-creates per tenant (cached)
const tenantNotesTable = Schema.createTable("tenant_notes", {
  id: Schema.varchar(64).primaryKey(),
  message: Schema.varchar(400).notNull(),
  created_by: Schema.varchar(120).notNull(),
  realm: Schema.varchar(40).notNull(),
  db_tenant: Schema.varchar(80).notNull(),
  created_at: Schema.timestamp().notNull().defaultNow(),
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
    tables: { tenant_notes: tenantNotesTable },
  },
  logging: {
    level: env.bool("DEBUG") ? "debug" : "info",
    pretty: true,
    file: false,
  },
});

service.use(requestLogger());

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
    const claims = decodeJwtPayload(result.accessToken);

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
      tokenPreview: {
        iss: claims.iss ?? null,
        azp: claims.azp ?? null,
        tenant: claims.tenant ?? null,
        tenantId: claims.tenant_id ?? null,
        preferredUsername: claims.preferred_username ?? null,
      },
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
    tenant: {
      realm: ctx.tenant.realm,
      realmSource: ctx.tenant.source,
      host: ctx.header("host") ?? null,
      userTenantId: ctx.user?.tenantId ?? null,
    },
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
    const notes = await ctx.db
      .table<NoteRow>("tenant_notes")
      .select("id", "message", "created_by", "realm", "db_tenant", "created_at")
      .orderByField("created_at", "desc")
      .get();

    return {
      tenant: { realm: ctx.tenant.realm, source: ctx.tenant.source },
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
    const username =
      (typeof ctx.user?.metadata?.preferred_username === "string" &&
        ctx.user.metadata.preferred_username) ||
      ctx.user?.id ||
      "anonymous";

    const note = await ctx.db.table<NoteRow>("tenant_notes").insert({
      id: crypto.randomUUID(),
      message: body.message,
      created_by: username,
      realm: ctx.tenant.realm,
      db_tenant: ctx.user?.tenantId ?? "unknown",
    });

    return {
      tenant: { realm: ctx.tenant.realm, source: ctx.tenant.source },
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
    authorize: "admin:global",
  },
  async (ctx: AppContext) => {
    const deleted = await ctx.db.table<NoteRow>("tenant_notes").delete();

    return {
      tenant: { realm: ctx.tenant.realm, source: ctx.tenant.source },
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
