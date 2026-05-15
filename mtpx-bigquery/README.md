# mtpx-bigquery

Example app demonstrating the `BigQueryClient` integration from `@linkd/sdk-typescript`.

## What it does

1. Initializes a `BigQueryClient` (from env vars or keystore)
2. Ensures a partitioned + clustered table `app_events` exists
3. Loads sample rows via NDJSON load job
4. Queries the table back to verify insertion

## Setup

```bash
cp .env.example .env
# Edit .env with your GCP project and credentials

bun install
```

## Credentials

**Option A — Keystore (production):**
Store your GCP service account JSON in the linkd keystore under `bigquery/default`. The app will fetch it automatically via `BigQueryClient.fromKeystore(ctx.keystore)`.

**Option B — Environment variables (local dev):**

| Variable | Description |
|----------|-------------|
| `BIGQUERY_PROJECT_ID` | GCP project ID (required) |
| `BIGQUERY_DATASET` | Default dataset name (default: `analytics`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Inline SA key JSON |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to SA key file |

## Run

```bash
bun run dev    # hot-reload
bun run start  # single run
```
