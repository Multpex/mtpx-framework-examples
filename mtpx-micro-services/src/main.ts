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
  StartupErrorHandler,
} from "@linkd/sdk-typescript";
import { migrations } from "./db/migrations.js";

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const err = error as Error & { code?: number; type?: string };
  const parts = [err.message];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.type) parts.push(`type=${err.type}`);
  return parts.join(" | ");
}

function printMigrationHint(message: string): void {
  const lower = message.toLowerCase();
  const missingDatabaseGateway =
    lower.includes("database gateway not configured") ||
    lower.includes("database router not configured");
  const shouldHint =
    lower.includes("default database pool") ||
    missingDatabaseGateway ||
    lower.includes("connection");

  if (!shouldHint) return;

  if (missingDatabaseGateway) {
    console.error(
      "\nHint: linkd is reachable, but its database gateway is unavailable.\n" +
        "Check linkd logs for one of these warnings:\n" +
        "  Failed to initialize database gateway\n" +
        "  Database gateway is enabled in config, but initialization failed; skipping keystore empty-router fallback.\n\n" +
        "If you want to rule out local env loading issues, restart linkd from ../../linkd or export .env.local manually.\n\n" +
        "For auth-only smoke tests, you can bypass startup migrations:\n" +
        "  SKIP_MIGRATIONS=true bun dev\n",
    );
    return;
  }

  console.error(
    "\nHint: start linkd with local DB env loaded before running micro-services:\n" +
      "  cd ../../linkd\n" +
      "  set -a && source .env.local && set +a && cargo run\n",
  );
}

class MicroservicesBootstrap {
  static async run(): Promise<void> {
    console.log("Starting microservices...\n");
    this.configureReconnectCoordinator();

    const loader = await this.startServices();
    await this.runMigrations(loader);

    console.log(
      `\n${loader.size} service(s) running: ${loader.getServiceNames().join(", ")}`,
    );
    console.log("Press Ctrl+C to stop.\n");
  }

  private static configureReconnectCoordinator(): void {
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
  }

  private static async startServices() {
    const loader = await startServices({
      servicesDir: "./src/services",
      namespace: env.string("LINKD_NAMESPACE", "moleculer-demo"),
      debug: env.bool("DEBUG"),
    });

    if (loader.size === 0) {
      throw new Error("No services found");
    }

    return loader;
  }

  private static async runMigrations(
    loader: Awaited<ReturnType<typeof startServices>>,
  ): Promise<void> {
    const migrationService = loader.getService("users") ?? loader.getServices()[0];
    const skipMigrations = env.bool("SKIP_MIGRATIONS", false);

    if (skipMigrations) {
      console.log("Migrations skipped (SKIP_MIGRATIONS=true)");
      return;
    }

    if (!migrationService?.runtime?.rawDb?.runMigrations) {
      return;
    }

    try {
      await migrationService.runtime.rawDb.runMigrations({
        migrations,
        direction: "up",
        dry_run: false,
      });
      console.log("Migrations applied");
    } catch (error) {
      const message = formatError(error);
      console.error("Migration failed:", message);
      printMigrationHint(message);
      throw error;
    }
  }
}

MicroservicesBootstrap.run().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
    formatError,
  }),
);
