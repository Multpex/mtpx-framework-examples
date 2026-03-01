/**
 * Orders Service
 * 
 * Manages order processing with PostgreSQL storage.
 * Demonstrates:
 * - Inter-service calls (users, products)
 * - Fluent Query Builder with createTypedService
 * - Event-driven patterns
 * - HTTP endpoint caching
 */

import { createService, env, z } from "@multpex/sdk-typescript";
import type { TypedServiceContext, EventContext } from "@multpex/sdk-typescript";
import type { Schema } from "../db/schema.js";

// Order item as stored in JSON (different from the order_items table)
type OrderLineItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

function normalizeOrderItemsForEvent(items: unknown): Array<{ productId: string; quantity: number }> {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is { product_id: string; quantity: number } =>
      Boolean(
        item
        && typeof item === "object"
        && "product_id" in item
        && "quantity" in item
        && typeof (item as { product_id?: unknown }).product_id === "string"
        && typeof (item as { quantity?: unknown }).quantity === "number",
      ))
    .map((item) => ({ productId: item.product_id, quantity: item.quantity }));
}

// Validation schemas
const CreateOrderSchema = z.object({
  userId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
    price: z.number().min(0),
  })).min(1),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
    postalCode: z.string(),
  }),
});

const UpdateOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]),
  notes: z.string().optional(),
});

// Context type alias for convenience
type Context = TypedServiceContext<Schema>;

const IS_PRODUCTION = env.string("NODE_ENV", "development") === "production";

// Create typed service - ctx.db is automatically TypedDatabase<Schema>
const service = createService<Schema>({
  name: "orders",
  version: "1.0.0",
  namespace: "microservice-demo",
});

// Lifecycle hooks
service.beforeStart(async () => {
  service.logger.info("Connecting to database...");
});

service.afterStart(async () => {
  // Configure HTTP response caching (handled by sidecar)
  await service.cache({
    defaultPolicy: {
      enabled: true,
      defaultTtlSeconds: 30,
      defaultMethods: ["GET"],
      addCacheHeaders: true,
    },
    endpoints: [
      {
        action: "list",
        route: "/orders",
        ttlSeconds: 30,
        varyHeaders: ["authorization"],
        cacheQueryParams: ["userId", "status", "page", "limit"],
      },
      {
        action: "get",
        route: "/orders/:id",
        ttlSeconds: 60,
        varyHeaders: ["authorization"],
      },
      {
        action: "stats",
        route: "/orders/stats",
        ttlSeconds: 120,
      },
    ],
    maxEntries: 1000,
  });

  service.logger.info("Service ready");
});

// Actions

/**
 * List orders with filtering
 * GET /orders?userId=xxx&status=pending&page=1&limit=20
 */
service.action("list", { route: "/orders", method: "GET", auth: true }, async (ctx: Context) => {
  const { userId, status, page = "1", limit = "20" } = ctx.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Fluent conditional filtering - no more "if (x) query = query.where()"
  const orders = await ctx.db.orders
    .select("id", "user_id", "status", "total", "items", "shipping_address", "created_at", "updated_at")
    .whereEqualsIf("user_id", userId)
    .whereEqualsIf("status", status)
    .orderByField("created_at", "desc")
    .limit(parseInt(limit))
    .offset(offset)
    .get();

  // Count with same filters
  const total = await ctx.db.orders
    .whereEqualsIf("user_id", userId)
    .whereEqualsIf("status", status)
    .count();

  return {
    orders,
    pagination: { page: parseInt(page), limit: parseInt(limit), total },
  };
});

/**
 * Get order by ID
 * GET /orders/:id
 */
service.action("get", { route: "/orders/:id", method: "GET", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;

  const order = await ctx.db.orders.whereEquals("id", id).first();

  if (!order) {
    throw Object.assign(new Error(`Order not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  return order;
});

/**
 * Create new order
 * POST /orders
 */
service.post("/orders", { auth: true}, async (ctx: Context) => {
  const data = CreateOrderSchema.parse(ctx.body);

  // Validate user exists via inter-service call
  try {
    await ctx.call("users", "get", { id: data.userId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`User validation failed (${data.userId}): ${msg}`), { code: 400, type: "VALIDATION_ERROR" });
  }

  // Validate products and build order items
  const orderItems: OrderLineItem[] = [];
  let total = 0;

  for (const item of data.items) {
    try {
      const product = await ctx.call<{ id: string; name: string; price: number }>("products", "get", { id: item.productId });
      const unitPrice = Number(product.price);
      const itemTotal = unitPrice * item.quantity;

      if (!Number.isFinite(unitPrice)) {
        throw Object.assign(new Error(`Invalid product price for ${item.productId}`), {
          code: 400,
          type: "VALIDATION_ERROR",
        });
      }

      if (item.price !== unitPrice) {
        ctx.logger.warn("Ignoring client-provided item price in favor of product price", {
          productId: item.productId,
          clientPrice: item.price,
          productPrice: unitPrice,
        });
      }

      orderItems.push({
        product_id: item.productId,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        total: itemTotal,
      });
      total += itemTotal;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`Product validation failed (${item.productId}): ${msg}`), { code: 400, type: "VALIDATION_ERROR" });
    }
  }

  const order = await ctx.db.orders.insert({
    user_id: data.userId,
    status: "pending",
    total,
    items: orderItems,
    shipping_address: data.shippingAddress,
  });

  // Reserve stock
  for (const item of data.items) {
    ctx.emit("stock.reserve", { productId: item.productId, quantity: item.quantity, orderId: order.id });
  }

  ctx.emit("order.created", { orderId: order.id, userId: data.userId, total, itemCount: data.items.length });
  await service.invalidateCache({ action: "list" });
  await service.invalidateCache({ action: "stats" });

  ctx.logger.info("Created order", { orderId: order.id, total });
  return order;
});

/**
 * Update order status
 * PATCH /orders/:id/status
 */
service.action("updateStatus", { route: "/orders/:id/status", method: "PATCH", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;
  const data = UpdateOrderStatusSchema.parse(ctx.body);

  const order = await ctx.db.orders
    .select("id", "user_id", "status", "total", "items")
    .whereEquals("id", id)
    .first();

  if (!order) {
    throw Object.assign(new Error(`Order not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  const previousStatus = order.status;
  await ctx.db.orders.whereEquals("id", id).update({ status: data.status });

  ctx.emit("order.statusChanged", { orderId: id, previousStatus, newStatus: data.status, notes: data.notes });

  if (data.status === "cancelled") {
    ctx.emit("stock.release", { orderId: id });
    ctx.emit("order.cancelled", { orderId: id, reason: data.notes });
  } else if (data.status === "delivered") {
    ctx.emit("order.completed", {
      orderId: id,
      userId: order.user_id,
      total: Number(order.total),
      items: normalizeOrderItemsForEvent(order.items),
    });
  }

  await service.invalidateCache({ pattern: `/orders/${id}` });
  await service.invalidateCache({ action: "list" });

  ctx.logger.info("Updated order status", { orderId: id, status: data.status });
  return { success: true, orderId: id, status: data.status };
});

/**
 * Cancel order
 * POST /orders/:id/cancel
 */
service.action("cancel", { route: "/orders/:id/cancel", method: "POST", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;
  const body = ctx.body as { reason?: string };

  const order = await ctx.db.orders
    .select("id", "status")
    .whereEquals("id", id)
    .first();

  if (!order) {
    throw Object.assign(new Error(`Order not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  if (order.status === "cancelled") {
    throw Object.assign(new Error("Order is already cancelled"), { code: 400, type: "VALIDATION_ERROR" });
  }

  if (order.status === "delivered") {
    throw Object.assign(new Error("Cannot cancel a delivered order"), { code: 400, type: "VALIDATION_ERROR" });
  }

  await ctx.db.orders.whereEquals("id", id).update({ status: "cancelled" });

  ctx.emit("stock.release", { orderId: id });
  ctx.emit("order.cancelled", { orderId: id, reason: body.reason ?? "User requested cancellation" });

  await service.invalidateCache({ pattern: `/orders/${id}` });
  await service.invalidateCache({ action: "list" });
  await service.invalidateCache({ action: "stats" });

  ctx.logger.info("Cancelled order", { orderId: id });
  return { success: true, orderId: id, status: "cancelled" };
});

/**
 * Get order statistics
 * GET /orders/stats
 */
service.action("stats", { route: "/orders/stats", method: "GET", auth: true }, async (ctx: Context) => {
  const [totalOrders, pendingOrders, deliveredOrders, deliveredList] = await Promise.all([
    ctx.db.orders.count(),
    ctx.db.orders.whereEquals("status", "pending").count(),
    ctx.db.orders.whereEquals("status", "delivered").count(),
    ctx.db.orders.select("total").whereEquals("status", "delivered").get(),
  ]);

  const revenue = deliveredList.reduce((sum, o) => sum + Number(o.total), 0);

  return {
    totalOrders,
    pendingOrders,
    deliveredOrders,
    revenue,
    updatedAt: new Date().toISOString(),
  };
});

// Event handlers

service.on("user.deleted", async (event: EventContext<{ userId: string }>, _ctx) => {
  service.logger.info("User deleted, cancelling orders", { userId: event.payload.userId });
  event.emit("order.userOrdersCancelled", { userId: event.payload.userId, reason: "User account deleted" });
});

service.on("payment.completed", async (event: EventContext<{ orderId: string; amount: number }>, _ctx) => {
  service.logger.info("Payment completed", { orderId: event.payload.orderId, amount: event.payload.amount });
  event.emit("order.statusChanged", { orderId: event.payload.orderId, previousStatus: "pending", newStatus: "confirmed", notes: "Payment received" });
});

service.on("product.unavailable", async (event: EventContext<{ productId: string }>, _ctx) => {
  service.logger.warn("Product unavailable", { productId: event.payload.productId });
});

export default service;
