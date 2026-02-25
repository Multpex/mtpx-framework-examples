import {
  createService,
  StartupErrorHandler,
  UnauthorizedError,
  z,
  env,
} from "@multpex/sdk-typescript";
import { KeycloakApiError, KeycloakClient } from "@multpex/sdk-typescript/keycloak";

type OidcCredentialData = Record<string, string>;

interface AdminClientContext {
  client: KeycloakClient;
  provider: string;
  realm: string;
}

const createRoleSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(255).optional(),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(120),
  email: z.string().email().optional(),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  password: z.string().min(4).max(200),
  enabled: z.boolean().default(true),
  roles: z.array(z.string().min(2).max(80)).default([]),
});

function pickFirst(data: OidcCredentialData, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeBaseUrl(rawValue: string): string {
  let value = rawValue.trim().replace(/\/+$/, "");

  value = value.replace(/\/\.well-known\/openid-configuration$/, "");
  value = value.replace(/\/admin\/.*$/, "");

  const realmsIndex = value.indexOf("/realms/");
  if (realmsIndex >= 0) {
    value = value.slice(0, realmsIndex);
  }

  return value;
}

function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
}

function mapKeycloakError(error: unknown): Error {
  if (!(error instanceof KeycloakApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.isAuthError || error.isForbidden) {
    return new UnauthorizedError(error.message);
  }

  return new Error(error.message);
}

interface KeystoreAwareContext {
  keystore: {
    get(serviceType: string, credentialName: string): Promise<OidcCredentialData>;
  };
}

async function buildAdminClient(
  ctx: KeystoreAwareContext,
): Promise<AdminClientContext> {
  const provider = env.string("OIDC_ADMIN_PROVIDER", "default");
  const credential = await ctx.keystore.get("oidc", provider);

  const configuredRealm = env.string("OIDC_ADMIN_REALM", "").trim();
  const realm = configuredRealm || pickFirst(credential, ["realm"]) || "master";

  const configuredClientId = env.string("OIDC_ADMIN_CLIENT_ID", "").trim();
  const clientId =
    configuredClientId
    || pickFirst(credential, ["client_id", "clientId"])
    || "";

  const configuredClientSecret = env.string("OIDC_ADMIN_CLIENT_SECRET", "").trim();
  const clientSecret =
    configuredClientSecret
    || pickFirst(credential, ["client_secret", "clientSecret"])
    || "";

  const rawBaseUrl =
    pickFirst(credential, ["base_url", "baseUrl", "url", "issuer_url", "issuerUrl"])
    || "";

  if (!rawBaseUrl) {
    throw new Error(
      `OIDC credential 'oidc/${provider}' is missing base_url/url/issuer_url`,
    );
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      `OIDC credential 'oidc/${provider}' is missing client_id/client_secret for admin operations`,
    );
  }

  const client = new KeycloakClient({
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    realm,
  });

  await client.auth({
    grantType: "client_credentials",
    clientId,
    clientSecret,
  });

  return { client, provider, realm };
}

const service = createService({
  name: "keycloak-admin-basics",
  namespace: env.string("LINKD_NAMESPACE", "keycloak-admin-example"),
  auth: {
    enabled: true,
    realm: env.string("AUTH_REALM", "multpex"),
    clientId: env.string("AUTH_CLIENT_ID", "multpex-services"),
  },
  logging: {
    level: env.bool("DEBUG") ? "debug" : "info",
    pretty: true,
  },
});

service.action(
  "health",
  {
    route: "/keycloak-admin/health",
    method: "GET",
  },
  async () => ({
    status: "ok",
    service: "keycloak-admin-basics",
    timestamp: new Date().toISOString(),
  }),
);

service.action(
  "roles.list",
  {
    route: "/keycloak-admin/roles",
    method: "GET",
    auth: true,
    roles: ["admin"],
  },
  async (ctx) => {
    try {
      const { client, realm, provider } = await buildAdminClient(ctx);
      const search = ctx.query.search?.trim() || undefined;
      const max = parseLimit(ctx.query.max, 50);
      const roles = await client.roles.list(realm, {
        search,
        max,
      });

      return {
        provider,
        realm,
        total: roles.length,
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          composite: role.composite,
        })),
      };
    } catch (error) {
      throw mapKeycloakError(error);
    }
  },
);

service.action(
  "roles.create",
  {
    route: "/keycloak-admin/roles",
    method: "POST",
    auth: true,
    roles: ["admin"],
    validate: createRoleSchema,
  },
  async (ctx) => {
    try {
      const { client, realm, provider } = await buildAdminClient(ctx);
      const payload = createRoleSchema.parse(ctx.body);

      const existing = await client.roles
        .getByName(realm, payload.name)
        .catch((error) => {
          if (error instanceof KeycloakApiError && error.isNotFound) {
            return null;
          }
          throw error;
        });

      if (existing) {
        return {
          provider,
          realm,
          created: false,
          role: {
            id: existing.id,
            name: existing.name,
            description: existing.description,
          },
        };
      }

      await client.roles.create(realm, {
        name: payload.name,
        description: payload.description,
      });

      const role = await client.roles.getByName(realm, payload.name);

      return {
        provider,
        realm,
        created: true,
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
        },
      };
    } catch (error) {
      throw mapKeycloakError(error);
    }
  },
);

service.action(
  "users.list",
  {
    route: "/keycloak-admin/users",
    method: "GET",
    auth: true,
    roles: ["admin"],
  },
  async (ctx) => {
    try {
      const { client, realm, provider } = await buildAdminClient(ctx);
      const search = ctx.query.search?.trim() || undefined;
      const max = parseLimit(ctx.query.max, 25);

      const users = await client.users.list(realm, {
        search,
        max,
        briefRepresentation: true,
      });

      return {
        provider,
        realm,
        total: users.length,
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          enabled: user.enabled,
          emailVerified: user.emailVerified,
          firstName: user.firstName,
          lastName: user.lastName,
        })),
      };
    } catch (error) {
      throw mapKeycloakError(error);
    }
  },
);

service.action(
  "users.create",
  {
    route: "/keycloak-admin/users",
    method: "POST",
    auth: true,
    roles: ["admin"],
    validate: createUserSchema,
  },
  async (ctx) => {
    try {
      const { client, realm, provider } = await buildAdminClient(ctx);
      const payload = createUserSchema.parse(ctx.body);

      const existing = await client.users.findByUsername(realm, payload.username);
      if (existing) {
        return {
          provider,
          realm,
          created: false,
          user: {
            id: existing.id,
            username: existing.username,
            email: existing.email,
          },
        };
      }

      const userId = await client.users.create(realm, {
        username: payload.username,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        enabled: payload.enabled,
        credentials: [
          {
            type: "password",
            value: payload.password,
            temporary: false,
          },
        ],
      });

      if (payload.roles.length > 0) {
        const roleMappings: Array<{ id: string; name: string }> = [];
        for (const roleName of payload.roles) {
          const role = await client.roles.getByName(realm, roleName);
          if (!role.id || !role.name) {
            throw new Error(`Role '${roleName}' does not have id/name`);
          }
          roleMappings.push({ id: role.id, name: role.name });
        }
        await client.users.addRealmRoles(realm, userId, roleMappings);
      }

      const createdUser = await client.users.get(realm, userId);
      const createdUserRoles = await client.users.getRealmRoles(realm, userId);

      return {
        provider,
        realm,
        created: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          email: createdUser.email,
          enabled: createdUser.enabled,
          roles: createdUserRoles.map((role) => role.name),
        },
      };
    } catch (error) {
      throw mapKeycloakError(error);
    }
  },
);

service.action(
  "users.assignRole",
  {
    route: "/keycloak-admin/users/:userId/roles/:roleName",
    method: "POST",
    auth: true,
    roles: ["admin"],
  },
  async (ctx) => {
    try {
      const { client, realm, provider } = await buildAdminClient(ctx);
      const userId = ctx.params.userId;
      const roleName = ctx.params.roleName;

      const role = await client.roles.getByName(realm, roleName);
      if (!role.id || !role.name) {
        throw new Error(`Role '${roleName}' does not have id/name`);
      }

      await client.users.addRealmRoles(realm, userId, [{
        id: role.id,
        name: role.name,
      }]);

      const updatedRoles = await client.users.getRealmRoles(realm, userId);

      return {
        provider,
        realm,
        userId,
        assignedRole: role.name,
        roles: updatedRoles.map((entry) => entry.name),
      };
    } catch (error) {
      throw mapKeycloakError(error);
    }
  },
);

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_CONNECT", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);
