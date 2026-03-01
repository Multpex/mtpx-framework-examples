/**
 * Auth Service
 *
 * Provides authentication endpoints for the application.
 * All authentication operations are handled by the SDK's auth client,
 * which communicates with linkd for identity provider access.
 *
 * This service is a thin wrapper that:
 * - Exposes REST endpoints for login, logout, refresh
 * - Emits auth events for other services to react to
 * - Delegates all auth logic to the SDK
 *
 * NO direct Keycloak URLs or secrets are used here.
 * Linkd handles all identity provider communication.
 */

const IS_PRODUCTION = env.string("NODE_ENV", "development") === "production";

import {
  createService,
  datetime,
  UnauthorizedError,
  env,
  z,
  type AuthUser,
} from "@multpex/sdk-typescript";
import type { TypedServiceContext } from "@multpex/sdk-typescript";
import type { Schema } from "../db/schema.js";
import { authConfig, config } from "../config.js";

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Login request schema.
 * realm and clientId are optional - they can also come from:
 * - X-Realm header
 * - Hostname subdomain (e.g., realm1.localhost:3000)
 * - Service config defaults
 *
 * SDK auto-extracts these and provides ctx.tenant with resolved values.
 */
const LoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  realm: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

// Context type alias
type Context = TypedServiceContext<Schema>;

// =============================================================================
// Service Definition
// =============================================================================

const service = createService<Schema>({
  name: "auth",
  version: "1.0.0",
  namespace: config.namespace,
  auth: {
    // define o padrão de autenticação para esta service - pode ser sobrescrito por endpoint/action
    enabled: true,
    ...authConfig,
  },
  defaults: {
    datetime: { displayTimezone: "America/Sao_Paulo" },
  },
});

// =============================================================================
// Lifecycle Hooks
// =============================================================================

service.beforeStart(async () => {
  service.logger.info("Starting authentication service", {
    defaultRealm: authConfig.realm,
    clientId: authConfig.clientId,
    configSource: "env/sdk defaults",
    knownRealms: authConfig.knownRealms ?? [],
    authClientMode: "managed via ctx.auth",
  });
});

service.afterStart(async () => {
  service.logger.info(
    "Service ready - auth client will be initialized on first request",
  );
});

// =============================================================================
// Actions
// =============================================================================

/**
 * Login with username/password
 * POST /auth/login
 *
 * Multi-tenant: realm is auto-resolved by SDK from:
 * 1. Request body (explicit realm parameter)
 * 2. X-Realm header
 * 3. Hostname subdomain (e.g., realm1.localhost:3000)
 * 4. Default realm from service config
 *
 * Access via ctx.tenant (realm, clientId, source)
 */
service.action(
  "login",
  {
    route: "/auth/login",
    method: "POST",
    validate: LoginSchema,
  },
  async (ctx: Context) => {
    const { username, password } = ctx.body as z.infer<typeof LoginSchema>;

    // Tenant (realm + clientId) is already resolved and auth client auto-configured by SDK
    ctx.logger.info("Login attempt", {
      username,
      realm: ctx.tenant.realm,
      clientId: ctx.tenant.clientId,
      source: ctx.tenant.source,
    });

    const result = await ctx.auth!.login({ username, password });

    // Validate we got a proper response
    if (!result.accessToken || !result.refreshToken) {
      throw new UnauthorizedError(
        "Invalid login response from identity provider",
      );
    }

    ctx.logger.info("Login successful", {
      username,
      realm: ctx.tenant.realm,
    });

    // Emit login event
    await ctx.emit("auth.login", {
      userId: result.user.id,
      username: result.user.username,
      roles: result.user.roles,
      realm: ctx.tenant.realm,
      timestamp: new Date().toISOString(),
    });

    const now = datetime.now();
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn,
      tokenType: result.tokenType,
      user: result.user,
      tenant: ctx.tenant, // Include tenant info in response for client awareness
      issuedAt: now.display,
    };
  },
);

/**
 * Refresh access token
 * POST /auth/refresh
 */
service.action(
  "refresh",
  {
    route: "/auth/refresh",
    method: "POST",
    validate: RefreshSchema,
  },
  async (ctx: Context) => {
    const { refreshToken } = ctx.body as z.infer<typeof RefreshSchema>;

    const result = await ctx.auth!.refresh(refreshToken);

    ctx.logger.info("Token refreshed");

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      refreshExpiresIn: result.refreshExpiresIn,
      tokenType: result.tokenType,
    };
  },
);

/**
 * Logout (revoke tokens)
 * POST /auth/logout
 */
service.action(
  "logout",
  {
    route: "/auth/logout",
    method: "POST",
    auth: true,
    validate: LogoutSchema,
  },
  async (ctx: Context) => {
    const { refreshToken } = ctx.body as z.infer<typeof LogoutSchema>;

    await ctx.auth!.logout(refreshToken);

    ctx.logger.info("User logged out", {
      userId: ctx.user?.id,
      username: ctx.user?.metadata?.username,
    });

    // Emit logout event
    if (ctx.user) {
      await ctx.emit("auth.logout", {
        userId: ctx.user.id,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true, message: "Logged out successfully" };
  },
);

/**
 * Get current user info
 * GET /auth/me
 *
 * Uses ctx.user injected by sidecar, or fetches fresh info from identity provider.
 */
service.action(
  "me",
  {
    route: "/auth/me",
    method: "GET",
    auth: true,
  },
  async (ctx: Context) => {
    if (!ctx.user) {
      throw new UnauthorizedError("Not authenticated");
    }

    // Try to get fresh info from identity provider
    const authHeader = ctx.headers?.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const userInfo = await ctx.auth!.getUserInfo(token);
        return userInfo;
      } catch {
        // Fall back to context user
      }
    }

    // Return user from context (injected by sidecar)
    return {
      id: ctx.user.id,
      username:
        ctx.user.metadata?.preferred_username ??
        ctx.user.metadata?.username ??
        "",
      email: ctx.user.metadata?.email,
      roles: ctx.user.roles ?? [],
      groups: [],
      metadata: ctx.user.metadata,
    } satisfies AuthUser;
  },
);

/**
 * Verify token validity
 * POST /auth/verify
 *
 * Note: The sidecar already validates the token and injects ctx.user.
 * This endpoint allows apps to explicitly check token validity.
 */
service.action(
  "verify",
  {
    route: "/auth/verify",
    method: "POST",
    auth: true,
  },
  async (ctx: Context) => {
    // If we reached here, sidecar validated the token
    if (!ctx.user) {
      return { valid: false, reason: "No user context" };
    }

    return {
      valid: true,
      user: {
        id: ctx.user.id,
        roles: ctx.user.roles ?? [],
        metadata: ctx.user.metadata,
      },
    };
  },
);

/**
 * Get OIDC discovery document
 * GET /auth/discovery
 *
 * Multi-tenant: realm auto-resolved by SDK
 */
service.action(
  "discovery",
  {
    route: "/auth/discovery",
    method: "GET",
  },
  async (ctx: Context) => {
    // Realm already resolved in ctx.realm, auth client auto-configured
    return ctx.auth!.getDiscovery();
  },
);

// =============================================================================
// Events
// =============================================================================

interface AuthEvent {
  userId: string;
  timestamp: string;
  username?: string;
  roles?: string[];
  realm?: string;
}

service.on<AuthEvent>("auth.login", async (event) => {
  service.logger.info("Login event received", {
    userId: event.payload.userId,
    username: event.payload.username,
    realm: event.payload.realm,
    timestamp: event.payload.timestamp,
  });
});

service.on<AuthEvent>("auth.logout", async (event) => {
  service.logger.info("Logout event received", {
    userId: event.payload.userId,
    timestamp: event.payload.timestamp,
  });
});

export default service;
