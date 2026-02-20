/**
 * Application Configuration
 *
 * Central configuration for the moleculer-style example app.
 * Uses the SDK's config module with app-specific overrides.
 *
 * Priority: Code overrides > Environment variables > SDK defaults
 */

import { createConfig, type ServiceEnvConfig } from "@multpex/typescript-sdk";

/**
 * App-specific configuration.
 * Extends the base SDK config with application defaults.
 */
export const config = createConfig({
  auth: {
    // App defaults (can be overridden by AUTH_REALM env var)
    realm: "multpex",
    clientId: "multpex-services",
    // Multi-tenant realms - requests from realm1.localhost go to realm1
    knownRealms: ["realm1", "realm2", "multpex", "multpex-test"],
  },
  namespace: "microservice-demo",
});

// Export individual config sections for convenience
export const { auth: authConfig } = config;
