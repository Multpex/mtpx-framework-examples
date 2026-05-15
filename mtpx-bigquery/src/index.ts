import {
  createApp,
  StartupErrorHandler,
  env,
} from "@linkd/sdk-typescript";
import { BigQueryClient } from "@linkd/sdk-typescript/bigquery";
import type { BqField } from "@linkd/sdk-typescript/bigquery";

// ─── Schema ─────────────────────────────────────────────────────
const eventsSchema: BqField[] = [
  { name: "event_id", type: "STRING" },
  { name: "tenant", type: "STRING" },
  { name: "event_type", type: "STRING" },
  { name: "payload", type: "STRING" },
  { name: "amount", type: "FLOAT64" },
  { name: "is_processed", type: "BOOLEAN" },
  { name: "event_date", type: "DATE" },
  { name: "created_at", type: "TIMESTAMP" },
];

// ─── App ────────────────────────────────────────────────────────
const app = createApp({
  name: "mtpx-bigquery",
  namespace: "mtpx-bigquery",
  logging: { level: "info", console: true, file: false },
});

app.afterConnect(async (ctx) => {
  let exitCode = 0;

  try {
    // ── Instantiate BigQuery client ─────────────────────────────
    // Production: loads GCP credentials from the linkd keystore
    //   const bq = await BigQueryClient.fromKeystore(ctx.keystore);
    //
    // Local dev: reads BIGQUERY_PROJECT_ID + GOOGLE_SERVICE_ACCOUNT_JSON
    const bq = BigQueryClient.fromEnv();

    app.logger.info("BigQuery client initialized", { projectId: bq.projectId });

    // ── Ensure dataset & table ──────────────────────────────────
    const datasetId = env.string("BIGQUERY_DATASET", "analytics");
    const dataset = bq.dataset(datasetId);
    const table = await bq.ensureTable(dataset, "app_events", eventsSchema, {
      timePartitioning: { type: "DAY", field: "created_at" },
      clustering: { fields: ["tenant", "event_type"] },
    });

    app.logger.info("Table ready", { dataset: datasetId, table: "app_events" });

    // ── Prepare sample rows ─────────────────────────────────────
    const now = new Date();
    const sampleRows = [
      {
        event_id: "evt-001",
        tenant: "acme",
        event_type: "order.created",
        payload: JSON.stringify({ orderId: "ORD-123", items: 3 }),
        amount: 149.90,
        is_processed: false,
        event_date: now,
        created_at: now,
      },
      {
        event_id: "evt-002",
        tenant: "acme",
        event_type: "order.paid",
        payload: JSON.stringify({ orderId: "ORD-123", method: "pix" }),
        amount: 149.90,
        is_processed: true,
        event_date: now,
        created_at: now,
      },
      {
        event_id: "evt-003",
        tenant: "globex",
        event_type: "user.signup",
        payload: JSON.stringify({ userId: "usr-42" }),
        amount: 0,
        is_processed: true,
        event_date: now,
        created_at: now,
      },
    ];

    // ── Sanitize & load ─────────────────────────────────────────
    const typeMap = BigQueryClient.makeBqTypeMap(eventsSchema);
    const sanitized = sampleRows.map((row) =>
      BigQueryClient.sanitizeRow(row, typeMap),
    );

    await bq.loadRows(table, sanitized, eventsSchema, {
      writeDisposition: "WRITE_APPEND",
    });

    app.logger.info("Rows loaded successfully", { count: sanitized.length });

    // ── Query back (optional verification) ──────────────────────
    const [queryRows] = await bq.raw.query({
      query: `SELECT event_id, tenant, event_type, amount
              FROM \`${bq.projectId}.${datasetId}.app_events\`
              ORDER BY created_at DESC
              LIMIT 10`,
    });

    app.logger.info("Recent events", {
      rows: queryRows.map((r: Record<string, unknown>) => ({
        event_id: r.event_id,
        tenant: r.tenant,
        event_type: r.event_type,
        amount: r.amount,
      })),
    });
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    app.logger.error("BigQuery flow failed", { error: message });
  } finally {
    await app.stop();
    process.exit(exitCode);
  }
});

await app.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Start linkd and try again.",
  }),
);
