# Session Report

Date: 2026-02-28
Project: `mtpx-keycloak-multi-tenant-routing`

## Goal

Leave the example fully functional with:

- Keycloak multi-tenant auth for `realm1.localhost` and `realm2.localhost`
- automatic tenant resolution by host
- DB routing without explicit tenant in app queries
- end-to-end proof that `sdk-typescript` + `linkd` route to the correct tenant DB
- cross-tenant token rejection
- reproducible local setup

## Final Working Flow

The final working path is:

1. `mtpx-framework-dev-infra/docker-compose-full.yml` starts `postgres`, `redis`, `nats`, `keycloak`, `elasticsearch`, and `linkd`
2. Keycloak realms are seeded with:
   - `multpex` for CLI/app-to-linkd auth
   - `realm1` and `realm2` for HTTP multi-tenant auth
3. `mtpx login` authenticates the local CLI session against `multpex`
4. The example app connects to `tcp://localhost:9999` using the CLI session JWT
5. HTTP login on `realm1.localhost` / `realm2.localhost` returns user tokens with:
   - `tenant=realm1|realm2`
   - `tenant_id=local_pg_realm1|local_pg_realm2`
6. `linkd` validates the user token, injects `ctx.user.tenantId`, and routes DB access to the correct tenant DB
7. The example rejects token/host realm mismatches

## Main Root Causes Found

### 1. Wrong Keycloak client secret and realm assumptions

Symptoms:

- `invalid_client`
- `Invalid client or Invalid client credentials`

Fixes:

- standardized client secrets to `multpex` in seeded realms
- clarified that app TCP auth uses the default realm `multpex`, while example HTTP auth uses `realm1` / `realm2`

### 2. `docker-compose-full.yml` was not aligned with the base compose

Symptoms:

- `No auth configuration for service '_internal'`
- keystore disabled
- TCP auth failures
- dynamic JWKS discovery using wrong host

Fixes:

- enabled OIDC/JWKS in `docker-compose-full.yml`
- enabled keystore in `docker-compose-full.yml`
- added `LINKD_KEYSTORE_DATABASE_URL`
- enabled TCP by default
- fixed Keycloak hostname settings:
  - `KC_HOSTNAME=http://localhost:8180`
  - `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`

### 3. Keystore encryption drift

Symptoms:

- `Failed to decrypt value with configured keys`
- `mtpx db server list` failing while `mtpx keystore list` still worked

Fixes:

- standardized a stable `LINKD_KEYSTORE_ENCRYPTION_KEY`
- documented that recreating infra without stable key causes decrypt drift
- added deterministic reset support in `mtpx-cli`

### 4. Runtime DB host mismatch for `linkd` running in Docker

Symptoms:

- `Database not found`
- pools not registered

Cause:

- credentials were being written with `host=localhost`, which is wrong from inside the `linkd` container

Fixes:

- added `--runtime-host` support to `mtpx db server add`
- required:
  - admin host: `localhost`
  - runtime host: `postgres`

### 5. Tenant naming mismatch

Symptoms:

- `Invalid tenant/database name`
- `linkd` rejecting names with `-`

Fixes:

- standardized tenant/database names to underscores only:
  - `local_pg_realm1`
  - `local_pg_realm2`
- updated realms, docs, example app, collection, and CLI flow accordingly

### 6. App startup TCP auth was being overridden by shell env

Symptoms:

- app failed on startup with `AuthenticationError: Invalid token`
- CLI commands still worked

Cause:

- shell exported `LINKD_TCP_TOKEN`, which injected a stale HS256 dev token during TCP handshake

Fixes:

- removed SDK support for `LINKD_TCP_TOKEN` / `TCP_TOKEN`
- updated docs and install/setup scripts to stop writing or recommending those env vars
- standardized TCP auth on `mtpx login` session

### 7. Cross-tenant token acceptance

Symptoms:

- `realm2` token accepted on `realm1.localhost`

Fixes:

- added cross-tenant validation in the example app
- added systemic validation in `sdk-typescript`
- added systemic validation in `linkd`

## Repositories Touched

### `mtpx-framework-examples`

- new multi-tenant example app
- Postman collection/environment
- README and setup docs

### `mtpx-framework-dev-infra`

- compose fixes for `linkd`
- compose fixes for Keycloak
- stable keystore config
- realm seed updates

### `mtpx-cli`

- `dev:reset`
- better provisioning validation
- runtime DB host support
- better provision error messages

### `sdk-typescript`

- stricter tenant alignment validation
- TCP auth token resolution cleanup
- removal of `LINKD_TCP_TOKEN` env override support

### `linkd`

- JWT/JWKS validation fixes
- cross-tenant enforcement
- config cleanup for deprecated TCP token env

## Final Clean Setup Contract

For this example to boot cleanly:

- Keycloak must be seeded from `docker-compose-full.yml` + `seed.sh`
- `mtpx logout && mtpx login` must be run after reseeding
- no `LINKD_TCP_TOKEN` / `TCP_TOKEN` must be exported in the shell
- DB server must be registered with:
  - `--host localhost`
  - `--runtime-host postgres`
- tenants must be provisioned as:
  - `local_pg_realm1`
  - `local_pg_realm2`
- app must use an SDK version that no longer reads `LINKD_TCP_TOKEN`

## Final Validation Signals

Environment is healthy when all of these hold:

- `mtpx keystore info` shows `Enabled: true`
- `mtpx keystore list` works
- app starts and authenticates to `tcp://localhost:9999`
- login works on both `realm1.localhost` and `realm2.localhost`
- `GET /tenant-routing/context` shows:
  - `realm1` -> `currentDatabase=local_pg_realm1`
  - `realm2` -> `currentDatabase=local_pg_realm2`
- cross-tenant token reuse is rejected

## Main Lessons

- `docker-compose.yml` and `docker-compose-full.yml` must stay aligned for auth-critical services
- local shell env can silently override the intended auth flow
- CLI session auth, app TCP auth, and end-user HTTP auth are separate layers and must be documented separately
- multi-tenant examples need one canonical tenant naming convention across Keycloak, `linkd`, SDK, CLI, docs, and Postman
