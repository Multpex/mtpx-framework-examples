import {
  createService,
  requestLogger,
  z,
} from "@multpex/sdk-typescript";

interface DemoMessageInput {
  orderId: string;
  customerId: string;
  total: number;
  priority: "normal" | "high";
  forceFail?: boolean;
}

const demoMessageSchema = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  total: z.number().positive(),
  priority: z.enum(["normal", "high"]).default("normal"),
  forceFail: z.boolean().optional(),
});

const app = createService({
  name: "svc-a",
  version: "1.0.0",
  namespace: "mtpx-msg-channels",
  health: {
    enabled: true,
    healthRoute: "/svc-a/health",
    readyRoute: "/svc-a/ready",
    liveRoute: "/svc-a/live",
  },
});

app.use(requestLogger());

app.beforeStart(async () => {
  app.logger.info("[BOOT][svc-a] iniciando publicador de demo...");
});

app.afterStart(async () => {
  app.logger.info("[BOOT][svc-a] pronto");
  app.logger.info("[ROUTE] POST /svc-a/demo/emit (broadcast)");
  app.logger.info("[ROUTE] POST /svc-a/demo/channel (load-balanced)");
  app.logger.info("[ROUTE] GET  /svc-a/demo/health");
});

app.action(
  "demo-health",
  { route: "/svc-a/demo/health", method: "GET", authRequired: true },
  async () => {
    return {
      status: "ok",
      service: "svc-a",
      eventName: "demo.order.created",
      channelName: "demo.order.created",
      note: "emit = broadcast | sendToChannel = load-balanced por grupo",
    };
  },
);

app.action(
  "demo-emit",
  {
    route: "/svc-a/demo/emit",
    method: "POST",
    authRequired: true,
    validate: demoMessageSchema,
  },
  async (ctx) => {
    const body = ctx.body as DemoMessageInput;
    const payload = {
      ...body,
      forceFail: Boolean(body.forceFail),
      createdAt: new Date().toISOString(),
      publisherService: "svc-a",
      mode: "emit" as const,
    };

    ctx.emit("demo.order.created", payload, true);

    app.logger.info("[EMIT][PUBLISH][svc-a] Evento broadcast publicado", {
      event: "demo.order.created",
      orderId: payload.orderId,
      customerId: payload.customerId,
    });

    return {
      success: true,
      mode: "emit",
      event: "demo.order.created",
      expected: "svc-b e svc-c recebem esta mensagem",
      payload,
    };
  },
);

app.action(
  "demo-channel",
  {
    route: "/svc-a/demo/channel",
    method: "POST",
    authRequired: true,
    validate: demoMessageSchema,
  },
  async (ctx) => {
    const body = ctx.body as DemoMessageInput;
    const payload = {
      ...body,
      forceFail: Boolean(body.forceFail),
      createdAt: new Date().toISOString(),
      publisherService: "svc-a",
      mode: "channel" as const,
    };

    ctx.sendToChannel("demo.order.created", payload);

    app.logger.info("[CHANNEL][PUBLISH][svc-a] Mensagem de channel publicada", {
      channel: "demo.order.created",
      orderId: payload.orderId,
      customerId: payload.customerId,
      note: "publisher não pertence a grupo — consumidores competem pelo delivery",
    });

    return {
      success: true,
      mode: "channel",
      channel: "demo.order.created",
      expected: "apenas UM entre svc-b/svc-c recebe cada mensagem (group=demo-workers)",
      payload,
    };
  },
);

export default app;
