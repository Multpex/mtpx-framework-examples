import {
  createService,
  type ChannelContext,
  type EventContext,
} from "@multpex/sdk-typescript";

interface DemoMessagePayload {
  orderId: string;
  customerId: string;
  total: number;
  priority: "normal" | "high";
  forceFail?: boolean;
  createdAt: string;
  publisherService: string;
  mode: "emit" | "channel";
}

let eventCount = 0;
let channelCount = 0;

const app = createService({
  name: "svc-c",
  version: "1.0.0",
  namespace: "mtpx-msg-channels",
  health: {
    enabled: true,
    healthRoute: "/svc-c/health",
    readyRoute: "/svc-c/ready",
    liveRoute: "/svc-c/live",
  },
});

app.beforeStart(async () => {
  app.logger.info("[BOOT][svc-c] iniciando consumidor...");
});

app.afterStart(async () => {
  app.logger.info("[BOOT][svc-c] pronto");
  app.logger.info("[SUB][EMIT] demo.order.created");
  app.logger.info("[SUB][CHANNEL] demo.order.created (group=demo-workers)");
});

app.on("demo.order.created", async (event: EventContext<DemoMessagePayload>) => {
  eventCount += 1;

  app.logger.info("[EMIT][RECEIVE][svc-c] Evento recebido (broadcast)", {
    eventName: event.name,
    orderId: event.payload.orderId,
    count: eventCount,
    note: "todo subscriber recebe emit",
  });
});

app.channel<DemoMessagePayload>(
  "demo.order.created",
  {
    group: "demo-workers",
    maxInFlight: 5,
    retryAttempts: 3,
    backoffType: "exponential",
    description: "svc-c compete com svc-b no mesmo group demo-workers",
  },
  async (ctx: ChannelContext<DemoMessagePayload>) => {
    try {
      channelCount += 1;

      app.logger.info("[CHANNEL][RECEIVE][svc-c] Mensagem recebida (load-balanced)", {
        channel: ctx.channel,
        group: ctx.group,
        orderId: ctx.body.orderId,
        messageId: ctx.message.id,
        count: channelCount,
        note: "apenas um subscriber por grupo recebe",
      });

      if (ctx.body.forceFail) {
        await ctx.message.nack({
          requeue: false,
          error: "Falha forçada em svc-c para demo",
        });
        return;
      }

      await ctx.message.ack();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.message.nack({ requeue: true, error: message });
    }
  },
);

app.action("demo-stats", { route: "/svc-c/demo/stats", method: "GET" }, async () => {
  return {
    service: "svc-c",
    eventReceived: eventCount,
    channelReceived: channelCount,
  };
});

export default app;
