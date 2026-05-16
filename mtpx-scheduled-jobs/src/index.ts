/**
 * Scheduled Jobs Example - API
 *
 * A partir da Fase 6, os schedulers são declarados de forma declarativa em
 * `mtpx.config.ts` (chave `mtpx.schedulers`). O SDK faz upsert automático
 * no boot — não há mais necessidade de endpoints `/jobs` e `/schedulers`
 * apenas para empacotar a API imperativa do `Queue`.
 *
 * Esta API mantém apenas operações de inspeção/operação das filas:
 * stats, drain, pause/resume e gestão da DLQ (Dead Letter Queue).
 *
 * O Worker (worker.ts) continua sendo responsável por processar os jobs.
 */

import {
  createApp,
  requestLogger,
  type Context,
  StartupErrorHandler,
  env,
} from "@linkd/sdk-typescript";

const service = createApp({
  name: "scheduler-api",
  version: "1.0.0",
  namespace: "scheduled-jobs-example",
  health: {
    enabled: true,
    healthRoute: "/health",
    readyRoute: "/ready",
    liveRoute: "/live",
  },
});

service.use(requestLogger());

service.beforeStart(async () => {
  console.log("⏳ Iniciando API de schedulers...");
});

service.afterStart(async () => {
  console.log("✅ API pronta!");
  console.log("📋 Endpoints disponíveis:");
  console.log("   GET    /queues/:name/stats  - Estatísticas da fila (auth)");
  console.log(
    "   DELETE /queues/:name/drain  - Limpar fila (remove TODOS os jobs não-ativos) (auth)",
  );
  console.log("   POST   /queues/:name/pause  - Pausar fila (auth)");
  console.log("   POST   /queues/:name/resume - Retomar fila (auth)");
  console.log("   --- Dead Letter Queue (DLQ) ---");
  console.log("   GET    /queues/:name/failed       - Listar jobs com falha (auth)");
  console.log(
    "   POST   /queues/:name/failed/:jobId/retry - Retry job com falha (auth)",
  );
  console.log("   DELETE /queues/:name/failed/:jobId - Remover job com falha (auth)");
  console.log(
    "   DELETE /queues/:name/failed       - Limpar todos jobs com falha (auth)",
  );
  console.log(
    "ℹ️  Schedulers são declarados em mtpx.config.ts (`mtpx.schedulers`)",
  );
});

// ============================================================================
// Actions
// ============================================================================

/**
 * GET /queues/:name/stats
 * Obter estatísticas de uma fila
 */
service.action(
  "queue-stats",
  { route: "/queues/:name/stats", method: "GET", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;
    const queue = service.queue(name);
    const stats = await queue.getJobCounts();

    return {
      queue: name,
      stats: {
        waiting: stats.waiting,
        active: stats.active,
        delayed: stats.delayed,
        completed: stats.completed,
        failed: stats.failed,
        prioritized: stats.prioritized,
        paused: stats.paused,
        total: stats.waiting + stats.active + stats.delayed,
      },
    };
  },
);

/**
 * DELETE /queues/:name/drain
 * Remover TODOS os jobs não-ativos de uma fila
 * (waiting, delayed, priority, completed, failed)
 */
service.action(
  "queue-drain",
  { route: "/queues/:name/drain", method: "DELETE", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;
    const queue = service.queue(name);

    // Obter contagem antes do drain
    const statsBefore = await queue.getJobCounts();

    const removed = await queue.drain();

    console.log(
      `🧹 Drain executado na fila '${name}': ${removed} jobs removidos`,
    );

    return {
      success: true,
      queue: name,
      removedCount: removed,
      statsBefore: {
        waiting: statsBefore.waiting,
        active: statsBefore.active,
        delayed: statsBefore.delayed,
        completed: statsBefore.completed,
        failed: statsBefore.failed,
      },
    };
  },
);

/**
 * POST /queues/:name/pause
 * Pausar uma fila
 */
service.action(
  "queue-pause",
  { route: "/queues/:name/pause", method: "POST", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;
    const queue = service.queue(name);
    await queue.pause();

    console.log(`⏸️  Fila '${name}' pausada`);

    return {
      success: true,
      queue: name,
      message: `Fila '${name}' pausada`,
    };
  },
);

/**
 * POST /queues/:name/resume
 * Retomar uma fila pausada
 */
service.action(
  "queue-resume",
  { route: "/queues/:name/resume", method: "POST", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;
    const queue = service.queue(name);
    await queue.resume();

    console.log(`▶️  Fila '${name}' retomada`);

    return {
      success: true,
      queue: name,
      message: `Fila '${name}' retomada`,
    };
  },
);

// ============================================================================
// Dead Letter Queue (DLQ) Endpoints
// ============================================================================

/**
 * GET /queues/:name/failed
 * Listar jobs com falha (DLQ)
 * Query params:
 *   - offset: Offset para paginação (default: 0)
 *   - limit: Limite de resultados (default: 20, max: 100)
 */
service.action(
  "queue-failed-list",
  { route: "/queues/:name/failed", method: "GET", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;
    const offset = parseInt((ctx.query?.offset as string) || "0", 10);
    const limit = Math.min(
      parseInt((ctx.query?.limit as string) || "20", 10),
      100,
    );

    const queue = service.queue(name);
    const result = await queue.getFailedJobs({ offset, limit });

    console.log(
      `📋 Listando ${result.jobs.length} de ${result.total} jobs com falha na fila '${name}'`,
    );

    return {
      queue: name,
      total: result.total,
      offset,
      limit,
      jobs: result.jobs.map((job) => ({
        jobId: job.jobId,
        jobName: job.jobName,
        error: job.error,
        attemptsMade: job.attemptsMade,
        failedAt: job.failedAt.toISOString(),
        data: job.data,
      })),
    };
  },
);

/**
 * POST /queues/:name/failed/:jobId/retry
 * Retry um job com falha (move de volta para a fila waiting)
 */
service.action(
  "queue-failed-retry",
  {
    route: "/queues/:name/failed/:jobId/retry",
    method: "POST",
    authRequired: true,
  },
  async (ctx: Context) => {
    const { name, jobId } = ctx.params;

    const queue = service.queue(name);
    await queue.retryFailedJob(jobId);

    console.log(`🔄 Job '${jobId}' da fila '${name}' enviado para retry`);

    return {
      success: true,
      queue: name,
      jobId,
      message: `Job '${jobId}' movido de volta para a fila waiting`,
    };
  },
);

/**
 * DELETE /queues/:name/failed/:jobId
 * Remover um job com falha permanentemente
 */
service.action(
  "queue-failed-remove",
  {
    route: "/queues/:name/failed/:jobId",
    method: "DELETE",
    authRequired: true,
  },
  async (ctx: Context) => {
    const { name, jobId } = ctx.params;

    const queue = service.queue(name);
    await queue.removeFailedJob(jobId);

    console.log(`🗑️  Job com falha '${jobId}' removido da fila '${name}'`);

    return {
      success: true,
      queue: name,
      jobId,
      message: `Job '${jobId}' removido permanentemente da DLQ`,
    };
  },
);

/**
 * DELETE /queues/:name/failed
 * Limpar todos os jobs com falha da DLQ
 */
service.action(
  "queue-failed-clear",
  { route: "/queues/:name/failed", method: "DELETE", authRequired: true },
  async (ctx: Context) => {
    const { name } = ctx.params;

    const queue = service.queue(name);
    const removedCount = await queue.clearFailedJobs();

    console.log(
      `🧹 ${removedCount} jobs com falha removidos da fila '${name}'`,
    );

    return {
      success: true,
      queue: name,
      removedCount,
      message: `${removedCount} jobs removidos da DLQ`,
    };
  },
);

/**
 * GET /health
 * Health check
 */
service.action("health", { route: "/health", method: "GET" }, async () => {
  return { status: "ok", service: "scheduler-api" };
});

// ============================================================================
// Startup
// ============================================================================

await service.start().catch((error) =>
  StartupErrorHandler.fail(error, {
    dependencyName: "Linkd",
    endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
    hint: "Inicie o Linkd e tente novamente.",
  }),
);
