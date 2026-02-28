import {
  createApp,
  requestLogger,
  requireRole,
  StartupErrorHandler,
  env,
  z,
  type Context,
  type EventContext,
  type EventSubscriptionContext,
} from "@multpex/sdk-typescript";

const INSTANCE_ID = env.string("INSTANCE_ID", crypto.randomUUID().slice(0, 8));

const service = createApp({
  name: "minimal-app",
  instanceId: INSTANCE_ID,
  namespace: "minimal-app",  // Namespace isolado para evitar conflitos
  auth: {
    realm: env.string("AUTH_REALM", "multpex"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
  },

  // Connection examples:
  // connect: "tcp://localhost:9999",  // TCP for development/remote debugging
  // connect: "/tmp/multpex.sock",                      // Unix socket (default)
});

service.use(requestLogger());

// Lifecycle hooks - usando service.logger integrado
service.beforeStart(async () => service.logger.info(`Initializing instance ${INSTANCE_ID}...`));
service.afterStart(async () => service.logger.info(`Service ready`, { instanceId: INSTANCE_ID }));
service.beforeStop(async () => service.logger.info(`Shutting down instance ${INSTANCE_ID}...`));

const createItemSchema = z.object({
  name: z.string().min(1).max(100),
  price: z.number().positive(),
  tags: z.array(z.string()).optional(),
});

type CreateItemInput = z.infer<typeof createItemSchema>;

// NOTA: armazenamento em memória — dados são perdidos ao reiniciar o processo.
// Em um app real, substitua por service.db() para persistência.
const items = new Map<
  string,
  { id: string; name: string; price: number; tags?: string[] }
>([
  ["1", { id: "1", name: "Widget", price: 19.99, tags: ["popular"] }],
  ["2", { id: "2", name: "Gadget", price: 29.99 }],
]);

// Actions (CRUD)

// List (with optional filtering by query params)
service.action("list", { route: "/minimal-app/items", method: "GET" }, async (ctx: Context) => {
  let result = Array.from(items.values());

  if (ctx.query?.id) {
    result = result.filter((item) => item.id === ctx.query.id);
  }

  if (ctx.query?.name) {
    result = result.filter((item) =>
      item.name.toLowerCase().includes(ctx.query.name.toLowerCase())
    );
  }

  return { items: result, instanceId: INSTANCE_ID };
});

service.action(
  "get",
  { route: "/minimal-app/items/:id", method: "GET" },
  async (ctx: Context) => {
    const item = items.get(ctx.params.id);
    if (!item) return { error: "Not found", statusCode: 404 };
    return item;
  },
);

// Create (auth + validation)
service.action(
  "create",
  {
    route: "/minimal-app/items",
    method: "POST",
    auth: true,
    validate: createItemSchema,
  },
  async (ctx: Context<CreateItemInput>) => {
    const id = crypto.randomUUID();
    const item = { id, ...ctx.body };
    items.set(id, item);

    // Invalida o cache do list para que a próxima leitura reflita o novo item.
    service.invalidateCache({ action: "list" });

    ctx.emit("item.created", { itemId: id, name: ctx.body.name });

    return item;
  },
);

// Delete (auth required)
service.action(
  "delete",
  { route: "/minimal-app/items/:id", method: "DELETE", auth: true, roles: ["admin"] },
  async (ctx: Context) => {
    if (!items.delete(ctx.params.id)) {
      return { error: "Not found", statusCode: 404 };
    }
    // Invalida o cache do list para que a próxima leitura reflita a remoção.
    service.invalidateCache({ action: "list" });
    ctx.emit("item.deleted", { itemId: ctx.params.id });
    return { success: true };
  },
);

service.on(
  "order.placed",
  async (event: EventContext<{ itemId: string }>, _ctx) => {
    console.log(`📦 Order placed for item: ${event.payload.itemId}`);
  },
);

// Handler with context (db, call, emit access)
service.on(
  "payment.received",
  async (
    event: EventContext<{ amount: number }>,
    ctx: EventSubscriptionContext,
  ) => {
    console.log(`💰 Payment: $${event.payload.amount}`);
    ctx.emit("notification.payment", { amount: event.payload.amount });
  },
);

service.on("audit.*", async (event: EventContext, _ctx) => {
  console.log(`📝 Audit: ${event.name}`);
});

service.group("/minimal-app/admin", (g) => {
  g.use(requireRole("admin"));

  g.action("stats", { route: "/stats", method: "GET" }, async () => {
    return {
      totalItems: items.size,
      totalValue: Array.from(items.values()).reduce(
        (sum, i) => sum + i.price,
        0,
      ),
    };
  });
});

service.addHealthCheck("database", async () => ({
  name: "database",
  status: "healthy",
  details: { connections: 5 },
}));

const mockMode = env.bool("MOCK_MODE");

if (mockMode) {
  console.log(
    "🧪 Mock mode - run with MOCK_MODE=true to skip sidecar connection\n",
  );

  const result = createItemSchema.safeParse({ name: "Test", price: 10 });
  console.log(`Validation test: ${result.success ? "✅" : "❌"}\n`);

  console.log("Registered actions:", service.getActionNames().join(", "));
  console.log("Event subscriptions:", service.getEventNames().join(", "));
} else {
  await service.start().catch((error) =>
    StartupErrorHandler.fail(error, {
      dependencyName: "Linkd",
      endpoint:
        env.coalesce("LINKD_CONNECT", "LINKD_URL") || "unix:/tmp/linkd.sock",
      hint: "Inicie o Linkd e tente novamente.",
    }),
  );

  await service.cors({ allowAnyOrigin: true });

  // Configurar cache DEPOIS de start() (requer conexão ao sidecar)
  await service.cache({
    defaultPolicy: {
      enabled: true,
      defaultTtlSeconds: 60,
    },
    endpoints: [
      { action: "list", ttlSeconds: 60 }, // 60s para listagem
      { action: "create", ttlSeconds: -1 }, // Nunca cachear mutations
      { action: "delete", ttlSeconds: -1 },
    ],
  });

  console.log(`🚀 Service running (Node: ${service.getNodeId()})`);

}
