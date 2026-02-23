import type { MigrationFile } from "@multpex/sdk-typescript";

export const migrations: MigrationFile[] = [
  {
    name: "001_init",
    version: "2026-01-29-0001",
    up_statements: [
      `CREATE TABLE IF NOT EXISTS "categories" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "name" VARCHAR(100) NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "parent_id" BIGINT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE TABLE IF NOT EXISTS "order_items" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "price" DECIMAL(10, 2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE TABLE IF NOT EXISTS "orders" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "total" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  "items" JSONB,
  "shipping_address" JSONB,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE TABLE IF NOT EXISTS "products" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10, 2) NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "reserved_stock" INTEGER NOT NULL DEFAULT 0,
  "category" VARCHAR(100),
  "tags" JSONB,
  "status" VARCHAR(50) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "role" VARCHAR(50) NOT NULL DEFAULT 'user',
  "status" VARCHAR(50) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
    ],
    down_statements: [
      "DROP TABLE IF EXISTS \"users\"",
      "DROP TABLE IF EXISTS \"products\"",
      "DROP TABLE IF EXISTS \"orders\"",
      "DROP TABLE IF EXISTS \"order_items\"",
      "DROP TABLE IF EXISTS \"categories\"",
    ],
  },

  // ============================================================================
  // Migration 002: Add unique constraint to users.email
  // This is an incremental migration - only runs if not already applied
  // ============================================================================
  {
    name: "002_users_email_unique",
    version: "2026-01-29-0002",
    up_statements: [
      `ALTER TABLE "users" ADD CONSTRAINT users_email_unique UNIQUE (email)`,
    ],
    down_statements: [
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS users_email_unique`,
    ],
  },
];
