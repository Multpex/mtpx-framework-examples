import { defineConfig, env } from "@linkd/sdk-typescript";

/**
 * Declarative scheduler configuration.
 *
 * Schedulers declared here are upserted automatically when the service starts
 * (Phase 6 — declarative queues/schedulers). The actual job handlers continue
 * to live in `src/worker.ts` (separate worker process), so we omit the
 * `handler` field — the SDK only upserts the cron entries and does not
 * register an in-process dispatcher worker.
 */
export default {
  name: "mtpx-scheduled-jobs",
  linkd: {
    socket: env.coalesce("MULTPEX_LINKD_SOCKET", "LINKD_SOCKET") || "/tmp/linkd.sock",
  },
  dev: {
    entry: "src/index.ts",
    watch: ["src"],
  },
  mtpx: defineConfig({
    queues: {
      jobs: { concurrency: 5 },
      monitoring: { concurrency: 2 },
    },
    schedulers: {
      "daily-report": {
        cron: "0 9 * * *",
        queue: "jobs",
        jobName: "GenerateReport",
        data: {
          type: "daily",
          recipients: ["admin@example.com", "team@example.com"],
        },
      },
      "weekly-cleanup": {
        cron: "0 3 * * SUN",
        queue: "jobs",
        jobName: "Cleanup",
        data: { olderThanDays: 30, table: "logs" },
      },
      "weekly-summary": {
        cron: "0 18 * * 5",
        queue: "jobs",
        jobName: "SendNotification",
        data: { channel: "email", message: "Resumo semanal disponível!" },
      },
      "health-check": {
        cron: "*/5 * * * *",
        queue: "monitoring",
        jobName: "health-check",
        data: { services: ["api", "database", "cache"] },
      },
    },
  }),
};
