/**
 * Microservices Example - Entry point
 *
 * Usage:
 *   bun run src/main.ts                          # all services
 *   SERVICE=users bun run src/main.ts             # single service
 *   SERVICE=users,orders bun run src/main.ts      # multiple services
 */

import {
  configureReconnectCoordinator,
  startServices,
  env,
} from "@multpex/typescript-sdk";
import { migrations } from "./db/migrations.js";

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const err = error as Error & { code?: number; type?: string };
  const parts = [err.message];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.type) parts.push(`type=${err.type}`);
  return parts.join(" | ");
}

(async () => {
  console.log("Starting microservices...\n");

  configureReconnectCoordinator({
    debounceMs: 100,
    maxBatchDelayMs: 500,
    retryBaseDelayMs: 250,
    maxRetryDelayMs: 5000,
    jitterRatio: 0.3,
    logger:
      env.bool("DEBUG")
        ? (message) => console.log(`[ReconnectCoordinator] ${message}`)
        : undefined,
  });

  const loader = await startServices({
    servicesDir: "./src/services",
    namespace: env.string("LINKD_NAMESPACE", "moleculer-demo"),
    debug: env.bool("DEBUG"),
  });

  if (loader.size === 0) {
    console.error("No services found");
    process.exit(1);
  }

  // Run migrations
  const migrationService =
    loader.getService("users") ?? loader.getServices()[0];
  if (migrationService?.db?.runMigrations) {
    try {
      await migrationService.db.runMigrations({
        migrations,
        direction: "up",
        dry_run: false,
      });
      console.log("Migrations applied");
    } catch (error) {
      console.error("Migration failed:", formatError(error));
      throw error;
    }
  }

  console.log(
    `\n${loader.size} service(s) running: ${loader.getServiceNames().join(", ")}`,
  );
  console.log("Press Ctrl+C to stop.\n");
})().catch((error) => {
  console.error("Fatal:", formatError(error));
  process.exit(1);
});
