import {
  createService,
  env,
  StartupErrorHandler,
  z,
  type TypedServiceContext,
} from "@linkd/sdk-typescript";

import type { JobRow, OrderRow, Schema, UserRow } from "./db/schema.js";

type Ctx = TypedServiceContext<Schema>;
type Db = NonNullable<Ctx["db"]>;

const LINKD_ENDPOINT = env.coalesce("LINKD_CONNECT", "LINKD_URL") ?? "unix:/tmp/linkd.sock";
const DATABASE_NAME = env.string("LINKD_DATABASE_NAME", "local-pg-fluentv2");

const service = createService<Schema>({
  name: "fluent-v2-lambda",
  namespace: "default",
  database: {
    defaultDatabase: DATABASE_NAME,
    allowRaw: true,
  },
  logging: {
    level: env.bool("DEBUG") ? "debug" : "info",
    console: true,
    file: false,
  },
});

const seedUsers: UserRow[] = [
  {
    id: "user-1",
    name: "Ada Lovelace",
    active: true,
    age: 28,
    tier: "pro",
    created_at: "2026-01-10T10:00:00Z",
  },
  {
    id: "user-2",
    name: "Grace Hopper",
    active: true,
    age: 67,
    tier: "enterprise",
    created_at: "2026-01-11T10:00:00Z",
  },
  {
    id: "user-3",
    name: "Margaret Hamilton",
    active: false,
    age: 35,
    tier: "starter",
    created_at: "2026-01-12T10:00:00Z",
  },
  {
    id: "user-4",
    name: "Barbara Liskov",
    active: true,
    age: 42,
    tier: "enterprise",
    created_at: "2026-01-13T10:00:00Z",
  },
];

const seedOrders: OrderRow[] = [
  {
    id: "order-1",
    user_id: "user-1",
    status: "completed",
    total: 120,
    created_at: "2026-02-01T10:00:00Z",
  },
  {
    id: "order-2",
    user_id: "user-2",
    status: "completed",
    total: 240,
    created_at: "2026-02-02T10:00:00Z",
  },
  {
    id: "order-3",
    user_id: "user-3",
    status: "pending",
    total: 80,
    created_at: "2026-02-03T10:00:00Z",
  },
  {
    id: "order-4",
    user_id: "user-4",
    status: "completed",
    total: 180,
    created_at: "2026-02-04T10:00:00Z",
  },
];

const seedJobs: JobRow[] = [
  {
    id: "job-1",
    tenant_id: "acme",
    status: "queued",
    priority: 20,
    attempt_count: 0,
    created_at: "2026-03-01T10:00:00Z",
  },
  {
    id: "job-2",
    tenant_id: "acme",
    status: "running",
    priority: 30,
    attempt_count: 1,
    created_at: "2026-03-02T10:00:00Z",
  },
  {
    id: "job-3",
    tenant_id: "globex",
    status: "queued",
    priority: 8,
    attempt_count: 0,
    created_at: "2026-03-03T10:00:00Z",
  },
  {
    id: "job-4",
    tenant_id: "acme",
    status: "done",
    priority: 50,
    attempt_count: 2,
    created_at: "2026-03-04T10:00:00Z",
  },
];

async function ensureSchema(db: Db): Promise<void> {
  await db.schema.createTableIfNotExists("users", (table) => {
    table.string("id", 64).primary();
    table.string("name", 120).notNullable();
    table.boolean("active").notNullable().default(false);
    table.integer("age").notNullable();
    table.string("tier", 40).notNullable();
    table.timestamp("created_at").notNullable().default("CURRENT_TIMESTAMP");
    table.index(["active"]);
    table.index(["tier"]);
  });

  await db.schema.createTableIfNotExists("orders", (table) => {
    table.string("id", 64).primary();
    table.string("user_id", 64).notNullable();
    table.string("status", 40).notNullable();
    table.decimal("total", 10, 2).notNullable();
    table.timestamp("created_at").notNullable().default("CURRENT_TIMESTAMP");
    table.index(["user_id"]);
    table.index(["status"]);
  });

  await db.schema.createTableIfNotExists("jobs", (table) => {
    table.string("id", 64).primary();
    table.string("tenant_id", 64).notNullable();
    table.string("status", 40).notNullable();
    table.integer("priority").notNullable();
    table.integer("attempt_count").notNullable().default(0);
    table.timestamp("created_at").notNullable().default("CURRENT_TIMESTAMP");
    table.index(["tenant_id"]);
    table.index(["status"]);
  });
}

async function seedDemoRows(db: Db): Promise<void> {
  for (const row of seedUsers) {
    await db.users.upsert(row, "id");
  }

  for (const row of seedOrders) {
    await db.orders.upsert(row, "id");
  }

  for (const row of seedJobs) {
    await db.jobs.upsert(row, "id");
  }
}

service.afterConnect(async (ctx) => {
  const db = ctx.db as unknown as Db;
  await ensureSchema(db);
  await seedDemoRows(db);
  service.logger.info("Fluent V2 lambda demo ready", {
    database: DATABASE_NAME,
    users: seedUsers.length,
    orders: seedOrders.length,
    jobs: seedJobs.length,
  });
});

service.get("/fluent-v2", { name: "index" }, async () => ({
  service: "mtpx-fluent-v2-lambda",
  routes: [
    "/fluent-v2/users/eligible",
    "/fluent-v2/users/picked",
    "/fluent-v2/orders/high-value",
    "/fluent-v2/jobs/dynamic?tenantId=acme&minPriority=10",
  ],
  notes: [
    "where((...) => ...) supports only the static subset parsed at runtime",
    "captured runtime values should use explicit builder methods instead of lambda capture",
  ],
}));

service.get(
  "/fluent-v2/users/eligible",
  { name: "eligible-users" },
  async (ctx: Ctx) => {
    const users = await ctx.db.users
      .where((u) => u.active && u.age >= 18 && u.age < 65)
      .orderByField("name", "asc")
      .get();

    return {
      example: 'where((u) => u.active && u.age >= 18 && u.age < 65)',
      users,
    };
  },
);

service.get(
  "/fluent-v2/users/picked",
  { name: "picked-users" },
  async (ctx: Ctx) => {
    const users = await ctx.db.users
      .where((u) => ["user-1", "user-4"].includes(u.id))
      .orderByField("name", "asc")
      .get();

    return {
      example: 'where((u) => ["user-1", "user-4"].includes(u.id))',
      users,
    };
  },
);

service.get(
  "/fluent-v2/orders/high-value",
  { name: "high-value-orders" },
  async (ctx: Ctx) => {
    const rows = await ctx.db.orders
      .join("users", (order, user) => order.user_id === user.id)
      .where((o, u) => o.status === "completed" && o.total >= 100 && ["pro", "enterprise"].includes(u.tier) && u.active)
      .get();

    return {
      example:
        'join("users", (order, user) => order.user_id === user.id).where((o, u) => o.status === "completed" && o.total >= 100 && ["pro", "enterprise"].includes(u.tier) && u.active)',
      rows,
    };
  },
);

const DynamicJobsQuery = z.object({
  tenantId: z.string().default("acme"),
  minPriority: z.coerce.number().int().default(10),
});

service.get(
  "/fluent-v2/jobs/dynamic",
  { name: "dynamic-jobs" },
  async (ctx: Ctx) => {
    const { tenantId, minPriority } = DynamicJobsQuery.parse(ctx.query);

    const jobs = await ctx.db.jobs
      .whereEquals("tenant_id", tenantId)
      .whereGt("priority", minPriority)
      .whereEquals("status", "queued")
      .orderByField("priority", "desc")
      .get();

    return {
      example:
        'whereEquals("tenant_id", tenantId).whereGt("priority", minPriority).whereEquals("status", "queued")',
      tenantId,
      minPriority,
      jobs,
    };
  },
);

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: LINKD_ENDPOINT,
    hint: `Inicie o Linkd e garanta que o database '${DATABASE_NAME}' está provisionado.`,
  }),
);
