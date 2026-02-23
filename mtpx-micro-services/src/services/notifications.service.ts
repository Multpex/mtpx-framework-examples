/**
 * Notifications Service
 *
 * Demonstrates Moleculer Channels with NATS JetStream.
 *
 * Channels vs Events:
 * - Channels: Load-balanced (one consumer per group receives each message)
 * - Events: Broadcast (all subscribers receive every message)
 *
 * JetStream provides: durable messaging, ack/nack flow control, DLQ
 */

import { createService } from "@multpex/sdk-typescript";
import type { TypedServiceContext, ChannelContext, EventContext } from "@multpex/sdk-typescript";
import type { Schema } from "../db/schema.js";


// Notification payload types
interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  priority?: "low" | "normal" | "high";
}

interface SmsNotification {
  phone: string;
  message: string;
}

type Context = TypedServiceContext<Schema>;

// Create service - SDK auto-configures health and logging from defaults
const service = createService<Schema>({
  name: "notifications",
  version: "1.0.0",
  namespace: "microservice-demo"
});

// ============================================================================
// HTTP Actions - Queue notifications via Channels
// ============================================================================

/** POST /notifications/email - Queue email for delivery */
service.action(
  "sendEmail",
  { route: "/notifications/email", method: "POST" },
  async (ctx: Context) => {
    const { to, subject, body, priority } = ctx.body as EmailNotification;

    if (!to || !subject || !body) {
      throw Object.assign(new Error("Missing: to, subject, body"), {
        code: 400,
        type: "VALIDATION_ERROR",
      });
    }

    // Channel = load-balanced: ONE worker processes this
    ctx.sendToChannel<EmailNotification>("notifications.email", {
      to,
      subject,
      body,
      priority: priority ?? "normal",
    });

    ctx.logger.info("Email queued", { to, subject });
    return { success: true, queued: "email" };
  }
);

/** POST /notifications/sms - Queue SMS for delivery */
service.action(
  "sendSms",
  { route: "/notifications/sms", method: "POST" },
  async (ctx: Context) => {
    const { phone, message } = ctx.body as SmsNotification;

    if (!phone || !message) {
      throw Object.assign(new Error("Missing: phone, message"), {
        code: 400,
        type: "VALIDATION_ERROR",
      });
    }

    ctx.sendToChannel<SmsNotification>("notifications.sms", { phone, message });

    ctx.logger.info("SMS queued", { phone });
    return { success: true, queued: "sms" };
  }
);

// ============================================================================
// Channel Handlers - Process queued messages (load-balanced)
// ============================================================================

/**
 * Email Channel
 * - group: "email-workers" → instances share load
 * - maxInFlight: 3 → process max 3 concurrently per instance
 * - ctx.message.ack() on success, ctx.message.nack({ requeue: true }) to retry
 */
service.channel<EmailNotification>(
  "notifications.email",
  { group: "email-workers", maxInFlight: 3 },
  async (ctx: ChannelContext<EmailNotification>) => {
    const { to, subject, priority } = ctx.body;

    service.logger.info("Sending email", { to, subject, priority });

    try {
      // Simulate email send
      await delay(100);
      if (Math.random() < 0.1) throw new Error("SMTP unavailable");

      await ctx.message.ack(); // ✅ Success
      service.logger.info("Email sent", { to });
    } catch (err) {
      service.logger.warn("📧 Email failed, requeueing", { to });
      await ctx.message.nack({ requeue: true }); // ❌ Retry
    }
  }
);

/**
 * SMS Channel
 * - group: "sms-workers"
 * - maxInFlight: 10 (SMS is faster)
 */
service.channel<SmsNotification>(
  "notifications.sms",
  { group: "sms-workers", maxInFlight: 10 },
  async (ctx: ChannelContext<SmsNotification>) => {
    const { phone, message } = ctx.body;

    service.logger.info("Sending SMS", { phone });

    try {
      await delay(50);
      if (Math.random() < 0.05) throw new Error("Gateway timeout");

      await ctx.message.ack();
      service.logger.info("SMS sent", { phone });
    } catch (err) {
      service.logger.error("SMS failed", { phone });
      await ctx.message.nack({ requeue: false }); // → DLQ
    }
  }
);

// ============================================================================
// Event Handler - React to broadcasts (all instances receive)
// ============================================================================

/** order.created event → queue email notification */
service.on(
  "order.created",
  async (event: EventContext<{ orderId: string; userId: string }>, _ctx) => {
    const { orderId, userId } = event.payload;
    service.logger.info("Order created", { orderId });

    // Event received by ALL instances, but Channel ensures
    // only ONE worker processes the email
    event.sendToChannel<EmailNotification>("notifications.email", {
      to: `user-${userId}@example.com`,
      subject: `Order ${orderId} Confirmed`,
      body: `Your order ${orderId} has been confirmed.`,
      priority: "high",
    });
  }
);

// ============================================================================
// Helpers
// ============================================================================

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default service;
