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
  name: "svc-b",
  version: "1.0.0",
  namespace: "mtpx-msg-channels",
  health: {
    enabled: true,
    healthRoute: "/svc-b/health",
    readyRoute: "/svc-b/ready",
    liveRoute: "/svc-b/live",
  },
});

app.beforeStart(async () => {
  app.logger.info("[BOOT][svc-b] iniciando consumidor...");
});

app.afterStart(async () => {
  app.logger.info("[BOOT][svc-b] pronto");
  app.logger.info("[SUB][EMIT] demo.order.created");
  app.logger.info("[SUB][CHANNEL] demo.order.created (group=demo-workers)");
});

app.on("demo.order.created", async (event: EventContext<DemoMessagePayload>) => {
  eventCount += 1;

  app.logger.info("[EMIT][RECEIVE][svc-b] Evento recebido (broadcast)", {
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
    description: "svc-b compete com svc-c no mesmo group demo-workers",
  },
  async (ctx: ChannelContext<DemoMessagePayload>) => {
    try {
      channelCount += 1;

      app.logger.info("[CHANNEL][RECEIVE][svc-b] Mensagem recebida (load-balanced)", {
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
          error: "Falha forçada em svc-b para demo",
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

app.action("demo-stats", { route: "/svc-b/demo/stats", method: "GET" }, async () => {
  return {
    service: "svc-b",
    eventReceived: eventCount,
    channelReceived: channelCount,
  };
});

export default app;
