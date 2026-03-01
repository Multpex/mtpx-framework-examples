/**
 * Products Service
 * 
 * Manages product catalog with PostgreSQL storage.
 * Demonstrates:
 * - CRUD operations with Fluent Query Builder
 * - Stock management
 * - HTTP endpoint caching
 * - Event handling
 */

import { createService, env, z } from "@multpex/sdk-typescript";
import type { TypedServiceContext, EventContext } from "@multpex/sdk-typescript";
import type { Schema } from "../db/schema.js";

// Type alias for typed context
type Context = TypedServiceContext<Schema>;

// Validation schemas
const CreateProductSchema = z.object({
  sku: z.string().min(3).max(50),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["active", "inactive", "discontinued"]).optional(),
});

const AdjustStockSchema = z.object({
  quantity: z.number().int(),
  reason: z.string().optional(),
});

const IS_PRODUCTION = env.string("NODE_ENV", "development") === "production";

// Create service with integrated logging
const service = createService<Schema>({
  name: "products",
  version: "1.0.0",
  namespace: "microservice-demo",
});

// Lifecycle hooks
service.beforeStart(async () => {
  service.logger.info("Starting...");
});

service.afterStart(async () => {
  // Configure HTTP response caching (handled by sidecar)
  await service.cache({
    defaultPolicy: {
      enabled: true,
      defaultTtlSeconds: 60,
      defaultMethods: ["GET"],
      addCacheHeaders: true,
    },
    endpoints: [
      {
        action: "list",
        route: "/products",
        ttlSeconds: 30,
        cacheQueryParams: ["category", "status", "page", "limit"],
      },
      {
        action: "get",
        route: "/products/:id",
        ttlSeconds: 60,
      },
      {
        action: "categories",
        route: "/products/categories",
        ttlSeconds: 300,
      },
    ],
    maxEntries: 2000,
  });

  service.logger.info("Service ready");
});

// Actions

/**
 * List products with filtering
 * GET /products?category=electronics&status=active&page=1&limit=20
 */
service.action("list", { route: "/products", method: "GET", auth: true }, async (ctx: Context) => {
  const { category, status, page = "1", limit = "20" } = ctx.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Fluent conditional filtering with when() for complex logic
  const products = await ctx.db.products
    .select("id", "sku", "name", "price", "stock", "reserved_stock", "category", "status")
    .whereEqualsIf("category", category)
    .when(status, 
      q => q.whereEquals("status", status),
      q => q.whereNot("status", "deleted")  // Default: exclude deleted
    )
    .orderByField("name", "asc")
    .limit(parseInt(limit))
    .offset(offset)
    .get();

  // Count with same filters
  const total = await ctx.db.products
    .whereEqualsIf("category", category)
    .when(status, 
      q => q.whereEquals("status", status),
      q => q.whereNot("status", "deleted")
    )
    .count();

  return {
    products,
    pagination: { page: parseInt(page), limit: parseInt(limit), total },
  };
});

/**
 * Get product by ID
 * GET /products/:id
 */
service.action("get", { route: "/products/:id", method: "GET", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;

  const product = await ctx.db.products.whereEquals("id", id).first();

  if (!product) {
    throw Object.assign(new Error(`Product not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  return { ...product, availableStock: product.stock - product.reserved_stock };
});

/**
 * Create new product
 * POST /products
 */
service.action("create", { route: "/products", method: "POST", auth: true, roles: ["admin"] }, async (ctx: Context) => {
  const data = CreateProductSchema.parse(ctx.body);

  // Check SKU exists
  const exists = await ctx.db.products.whereEquals("sku", data.sku).exists();
  if (exists) {
    throw Object.assign(new Error(`SKU already exists: ${data.sku}`), { code: 409, type: "CONFLICT" });
  }

  const product = await ctx.db.products.insert({
    sku: data.sku,
    name: data.name,
    description: data.description || null,
    price: data.price,
    stock: data.stock,
    reserved_stock: 0,
    category: data.category || null,
    tags: data.tags || [],
    status: "active",
  });

  ctx.emit("product.created", { productId: product.id, sku: data.sku, name: data.name });
  await service.invalidateCache({ action: "list" });
  await service.invalidateCache({ action: "categories" });

  ctx.logger.info("Created product", { productId: product.id, sku: data.sku });
  return product;
});

/**
 * Update product
 * PUT /products/:id
 */
service.action("update", { route: "/products/:id", method: "PUT", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;
  const data = UpdateProductSchema.parse(ctx.body);

  const exists = await ctx.db.products.whereEquals("id", id).exists();
  if (!exists) {
    throw Object.assign(new Error(`Product not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  await ctx.db.products.whereEquals("id", id).updateDefinedOrFail(data);
  const product = await ctx.db.products.whereEquals("id", id).first();

  ctx.emit("product.updated", { productId: id, changes: data });
  await service.invalidateCache({ pattern: `/products/${id}` });
  await service.invalidateCache({ action: "list" });

  ctx.logger.info("Updated product", { productId: id });
  return product;
});

/**
 * Adjust stock
 * POST /products/:id/stock
 */
service.action("adjustStock", { route: "/products/:id/stock", method: "POST", auth: true }, async (ctx: Context) => {
  const { id } = ctx.params;
  const { quantity, reason } = AdjustStockSchema.parse(ctx.body);

  const product = await ctx.db.products
    .select("id", "name", "stock", "reserved_stock", "status")
    .whereEquals("id", id)
    .first();

  if (!product) {
    throw Object.assign(new Error(`Product not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  const newStock = product.stock + quantity;
  if (newStock < 0) {
    throw Object.assign(new Error(`Insufficient stock. Current: ${product.stock}, Requested: ${quantity}`), { code: 400, type: "INSUFFICIENT_STOCK" });
  }

  await ctx.db.products.whereEquals("id", id).update({ stock: newStock });

  ctx.emit("product.stockChanged", { productId: id, previousStock: product.stock, newStock, change: quantity, reason });
  if (newStock === 0) {
    ctx.emit("product.outOfStock", { productId: id, name: product.name });
  }

  await service.invalidateCache({ pattern: `/products/${id}` });
  await service.invalidateCache({ action: "list" });

  ctx.logger.info("Adjusted stock", { productId: id, previousStock: product.stock, newStock, change: quantity });
  return { productId: id, previousStock: product.stock, newStock, change: quantity };
});

/**
 * Delete product (soft delete)
 * DELETE /products/:id
 */
service.action("delete", { route: "/products/:id", method: "DELETE", auth: true, roles: ["admin"] }, async (ctx: Context) => {
  const { id } = ctx.params;

  const exists = await ctx.db.products.whereEquals("id", id).exists();
  if (!exists) {
    throw Object.assign(new Error(`Product not found: ${id}`), { code: 404, type: "NOT_FOUND" });
  }

  await ctx.db.products.whereEquals("id", id).update({ status: "deleted" });

  ctx.emit("product.deleted", { productId: id });
  await service.invalidateCache({ pattern: `/products/${id}` });
  await service.invalidateCache({ action: "list" });
  await service.invalidateCache({ action: "categories" });

  ctx.logger.info("Deleted product", { productId: id });
  return { success: true, message: `Product ${id} deleted` };
});

/**
 * Get all categories
 * GET /products/categories
 */
service.action("categories", { route: "/products/categories", method: "GET", auth: true }, async (ctx: Context) => {
  const products = await ctx.db.products
    .select("category")
    .whereEquals("status", "active")
    .whereNotNull("category")
    .get();

  // Aggregate categories in-memory
  const counts = new Map<string, number>();
  for (const p of products) {
    counts.set(p.category!, (counts.get(p.category!) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, productCount]) => ({ category, productCount }))
    .sort((a, b) => b.productCount - a.productCount);
});

// Event handlers

service.on("stock.reserve", async (event: EventContext<{ productId: string; quantity: number; orderId: string }>, _ctx) => {
  service.logger.info("Stock reservation", { productId: event.payload.productId, quantity: event.payload.quantity, orderId: event.payload.orderId });
});

service.on("stock.release", async (event: EventContext<{ productId: string; quantity: number; orderId: string }>, _ctx) => {
  service.logger.info("Stock release", { productId: event.payload.productId, quantity: event.payload.quantity, orderId: event.payload.orderId });
});

service.on("order.completed", async (event: EventContext<{ orderId: string; items?: Array<{ productId: string; quantity: number }> }>, _ctx) => {
  service.logger.info("Order completed, updating stock", {
    orderId: event.payload.orderId,
    itemCount: event.payload.items?.length ?? 0,
  });
});

export default service;
