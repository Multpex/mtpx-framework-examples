/**
 * Users Service
 * 
 * Manages user accounts with PostgreSQL storage.
 * Demonstrates:
 * - CRUD operations with Fluent Query Builder
 * - HTTP endpoint caching
 * - Event emission (user.created, user.updated, user.deleted)
 */

import { z } from "zod";
import { createService, ConflictError, NotFoundError, env } from "@multpex/typescript-sdk";
import type { TypedServiceContext, EventContext } from "@multpex/typescript-sdk";
import type { Schema } from "../db/schema.js";

// Type alias for typed context
type Context = TypedServiceContext<Schema>;

// Validation schemas
const CreateUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "user", "guest"]).optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
});

const IS_PRODUCTION = env.string("NODE_ENV", "development") === "production";

// Create service with integrated logging
const service = createService<Schema>({
  name: "users",
  version: "1.0.0",
  namespace: "microservice-demo",
});

// Lifecycle hooks - usando service.logger integrado
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
        route: "/users",
        ttlSeconds: 30,
        varyHeaders: ["authorization"],
        cacheQueryParams: ["status", "role", "page", "limit"],
      },
      {
        action: "get",
        route: "/users/:id",
        ttlSeconds: 60,
        varyHeaders: ["authorization"],
      },
      {
        action: "stats",
        route: "/users/stats",
        ttlSeconds: 120,
      },
    ],
    maxEntries: 1000,
  });

  service.logger.info("Service ready");
});

// Actions

/**
 * List users with filtering
 * GET /users?status=active&role=user&page=1&limit=20
 */
service.action("list", { route: "/users", method: "GET", auth: true }, async (ctx: Context) => {
  const { status, role, page = "1", limit = "20" } = ctx.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Fluent conditional filtering - clean and readable
  const users = await ctx.db.users
    .select("id", "name", "email", "role", "status", "created_at", "updated_at")
    .whereEqualsIf("status", status)
    .whereEqualsIf("role", role)
    .orderByField("created_at", "desc")
    .limit(parseInt(limit))
    .offset(offset)
    .get();

  // Count with same filters
  const total = await ctx.db.users
    .whereEqualsIf("status", status)
    .whereEqualsIf("role", role)
    .count();

  return {
    users,
    pagination: { page: parseInt(page), limit: parseInt(limit), total },
  };
});

/**
 * Get user by ID
 * GET /users/:id
 */
service.action("get", { route: "/users/:id", method: "GET", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;

  const user = await ctx.db.users.whereEquals("id", id).first();

  if (!user) {
    throw NotFoundError.forResource("User", id);
  }

  return user;
});

/**
 * Create new user
 * POST /users
 * 
 * Optimized: Uses insertOrNull with ON CONFLICT to avoid 2 roundtrips.
 */
service.action("create", { route: "/users", method: "POST", auth: true, roles: ["admin"] }, async (ctx: Context) => {
  const data = CreateUserSchema.parse(ctx.body);

  // Single query: INSERT ... ON CONFLICT (email) DO NOTHING RETURNING *
  const user = await ctx.db.users.insertOrNull(
    { name: data.name, email: data.email, role: data.role, status: "active" },
    "email",
  );

  if (!user) {
    throw ConflictError.duplicate("User", "email", data.email);
  }

  // Fire-and-forget: emit event and invalidate cache
  ctx.emit("user.created", { userId: user.id, email: data.email, role: data.role });
  service.invalidateCache({ action: "list" });
  service.invalidateCache({ action: "stats" });

  return user;
});

/**
 * Update user
 * PUT /users/:id
 */
service.action("update", { route: "/users/:id", method: "PUT", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;
  const data = UpdateUserSchema.parse(ctx.body);

  const exists = await ctx.db.users.whereEquals("id", id).exists();
  if (!exists) {
    throw NotFoundError.forResource("User", id);
  }

  // Update only defined fields, throws if no fields provided
  await ctx.db.users.whereEquals("id", id).updateDefinedOrFail(data);
  const user = await ctx.db.users.whereEquals("id", id).first();

  ctx.emit("user.updated", { userId: id, changes: data });
  service.invalidateCache({ pattern: `/users/${id}` });
  service.invalidateCache({ action: "list" });

  ctx.logger.info("Updated user", { userId: id });
  return user;
});

/**
 * Delete user (soft delete)
 * DELETE /users/:id
 */
service.action("delete", { route: "/users/:id", method: "DELETE", auth: true, roles: ["admin"] }, async (ctx: Context) => {
  const { id } = ctx.params;

  const exists = await ctx.db.users.whereEquals("id", id).exists();
  if (!exists) {
    throw NotFoundError.forResource("User", id);
  }

  await ctx.db.users.whereEquals("id", id).update({ status: "deleted" });

  ctx.emit("user.deleted", { userId: id });
  service.invalidateCache({ pattern: `/users/${id}` });
  service.invalidateCache({ action: "list" });
  service.invalidateCache({ action: "stats" });

  ctx.logger.info("Deleted user", { userId: id });
  return { success: true, message: `User ${id} deleted` };
});

/**
 * Get user statistics
 * GET /users/stats
 */
service.action("stats", { route: "/users/stats", method: "GET", auth: true }, async (ctx: Context) => {
  const [total, active, inactive, suspended] = await Promise.all([
    ctx.db.users.count(),
    ctx.db.users.whereEquals("status", "active").count(),
    ctx.db.users.whereEquals("status", "inactive").count(),
    ctx.db.users.whereEquals("status", "suspended").count(),
  ]);

  return { total, active, inactive, suspended, updatedAt: new Date().toISOString() };
});

// Event handlers

service.on("order.completed", async (event: EventContext<{ userId: string; orderId: string; total: number }>, _ctx) => {
  service.logger.info("Order completed", { userId: event.payload.userId, total: event.payload.total });
});

service.on("product.outOfStock", async (event: EventContext<{ productId: string; name: string }>, _ctx) => {
  service.logger.warn("Product out of stock", { productId: event.payload.productId, name: event.payload.name });
});

export default service;
