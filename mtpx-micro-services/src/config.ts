/**
 * Application Configuration
 *
 * Central configuration for the moleculer-style example app.
 * Uses the SDK's config module with app-specific overrides.
 *
 * Priority: Code overrides > Environment variables > SDK defaults
 */

import {
  createConfig,
  env,
  type ServiceEnvConfig,
} from "@multpex/sdk-typescript";

/**
 * App-specific configuration.
 * Extends the base SDK config with application defaults.
 */
export const config = createConfig({
  auth: {
    // Explicitly sourced from env to keep .env as source-of-truth in local dev.
    realm: env.string("AUTH_REALM", "multpex"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
    // Multi-tenant realms - requests from realm1.localhost go to realm1
    knownRealms: ["realm1", "realm2", "multpex", "multpex-test"],
  },
  namespace: env.string("LINKD_NAMESPACE", "microservice-demo"),
});

// Export individual config sections for convenience
export const { auth: authConfig } = config;
