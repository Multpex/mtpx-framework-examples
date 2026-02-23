/**
 * WebSocket Chat Example - Entry Point
 *
 * Demonstrates the WebSocket API following the same pattern as HTTP actions.
 */

import {
  startServices,
  configureReconnectCoordinator,
  env,
  StartupErrorHandler,
} from "@multpex/sdk-typescript";

(async () => {
  console.log("\n🔌 Starting WebSocket Chat Example\n");

  // Configure reconnection behavior
  configureReconnectCoordinator({
    debounceMs: 100,
    maxBatchDelayMs: 500,
    retryBaseDelayMs: 250,
    maxRetryDelayMs: 5000,
    jitterRatio: 0.3,
  });

  // Load and start all services
  const loader = await startServices({
    servicesDir: "./src/services",
    namespace: env.string("LINKD_NAMESPACE", "websocket-chat"),
    debug: env.bool("DEBUG"),
  });

  if (loader.size === 0) {
    throw new Error("No services found");
  }

  console.log(`\n✅ ${loader.size} service(s) running: ${loader.getServiceNames().join(", ")}`);
  console.log("\n📡 WebSocket endpoint: /ws/chat");
  console.log("📝 HTTP endpoints:");
  console.log("   - GET  /chat/rooms/:id   - Get room details");
  console.log("   - POST /chat/rooms       - Create a new room");
  console.log("\nPress Ctrl+C to stop.\n");
})().catch((error) => {
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  });
});
