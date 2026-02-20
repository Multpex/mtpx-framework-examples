/**
 * Scheduled Jobs Example - API
 *
 * Este arquivo demonstra como criar e gerenciar schedulers via API HTTP.
 * Os schedulers definem QUANDO criar jobs na fila.
 *
 * O Worker (worker.ts) define O QUE FAZER quando receber o job.
 */

import {
  createApp,
  setupGracefulShutdown,
  requestLogger,
  z,
  type Context,
  BadRequestError,
} from "@multpex/typescript-sdk";

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
  console.log("   POST   /jobs             - Criar job para execução imediata (auth)");
  console.log("   POST   /schedulers       - Criar/atualizar scheduler (auth)");
  console.log("   GET    /schedulers       - Listar schedulers (auth)");
  console.log("   DELETE /schedulers/:key  - Remover scheduler (auth)");
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
});

// ============================================================================
// Schemas de Validação
// ============================================================================

const createJobSchema = z.object({
  // Nome da fila (default: "jobs")
  queue: z.string().min(1).max(100).default("jobs"),
  // Nome do job (o worker usa isso para decidir o que fazer)
  name: z.string().min(1).max(100),
  // Dados que serão passados para o job
  data: z.record(z.unknown()).default({}),
  // Delay em ms antes de executar (0 = imediato)
  delay: z.number().int().min(0).default(0),
  // Prioridade (maior = mais prioritário)
  priority: z.number().int().min(0).default(0),
  // Número de tentativas em caso de falha
  attempts: z.number().int().min(1).default(3),
});

type CreateJobInput = z.infer<typeof createJobSchema>;

const createSchedulerSchema = z.object({
  schedulerKey: z.string().min(1).max(100),
  // Nome da fila (default: "jobs")
  queue: z.string().min(1).max(100).default("jobs"),
  // Cron pattern (ex: "0 9 * * *") - mutualmente exclusivo com 'every'
  pattern: z.string().optional(),
  // Intervalo em ms (ex: 60000 = 1 min) - mutualmente exclusivo com 'pattern'
  every: z.number().positive().optional(),
  // Nome do job (o worker usa isso para decidir o que fazer)
  jobName: z.string().min(1).max(100),
  // Dados que serão passados para o job
  data: z.record(z.unknown()).default({}),
  // Timezone para cron (ex: "America/Sao_Paulo")
  timezone: z.string().optional(),
  // Limite de execuções (0 = ilimitado)
  limit: z.number().int().min(0).optional(),
});

type CreateSchedulerInput = z.infer<typeof createSchedulerSchema>;

// ============================================================================
// Actions
// ============================================================================

/**
 * POST /jobs
 * Criar um job para execução imediata (ou com delay)
 */
service.action(
  "create-job",
  {
    route: "/jobs",
    method: "POST",
    authRequired: true,
    validate: createJobSchema,
  },
  async (ctx: Context<CreateJobInput>) => {
    const {
      queue: queueName,
      name,
      data,
      delay,
      priority,
      attempts,
    } = ctx.body;

    const queue = service.queue(queueName);

    const job = await queue.add(name, data, {
      delay,
      priority,
      attempts,
      backoff: { type: "exponential", delay: 5000 },
    });

    const executeAt = delay > 0 ? new Date(Date.now() + delay) : null;

    console.log(`📤 Job criado: ${name}`);
    console.log(`   Fila: ${queueName}`);
    console.log(`   ID: ${job.id}`);
    if (executeAt) {
      console.log(`   Execução em: ${executeAt.toISOString()}`);
    }

    return {
      success: true,
      jobId: job.id,
      queue: queueName,
      name,
      delay,
      executeAt: executeAt?.toISOString() ?? null,
    };
  },
);

/**
 * POST /schedulers
 * Criar ou atualizar um scheduler
 */
service.action(
  "create-scheduler",
  {
    route: "/schedulers",
    method: "POST",
    authRequired: true,
    validate: createSchedulerSchema,
  },
  async (ctx: Context<CreateSchedulerInput>) => {
    const {
      schedulerKey,
      queue: queueName,
      pattern,
      every,
      jobName,
      data,
      timezone,
      limit,
    } = ctx.body;

    // Validar: precisa ter pattern OU every
    if (!pattern && !every) {
      throw new BadRequestError(
        "É necessário informar 'pattern' (cron) ou 'every' (intervalo em ms)",
      );
    }

    if (pattern && every) {
      throw new BadRequestError(
        "Informe apenas 'pattern' (cron) OU 'every' (intervalo), não ambos",
      );
    }

    // Obter queue via service.queue (usando nome da fila do body)
    const queue = service.queue(queueName);

    // Upsert scheduler
    const result = await queue.upsertJobScheduler(
      schedulerKey,
      {
        pattern,
        every,
        timezone,
        limit,
      },
      {
        name: jobName,
        data: data as Record<string, unknown>,
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      },
    );

    const nextRunDate = new Date(Number(result.nextRun));

    console.log(`📅 Scheduler criado: ${schedulerKey}`);
    console.log(`   Fila: ${queueName}`);
    console.log(`   Job: ${jobName}`);
    console.log(`   Próxima execução: ${nextRunDate.toISOString()}`);

    return {
      success: true,
      schedulerKey: result.schedulerKey,
      queue: queueName,
      nextRun: nextRunDate.toISOString(),
      nextRunMs: Number(result.nextRun),
    };
  },
);

/**
 * GET /schedulers
 * Listar todos os schedulers
 * Query params:
 *   - queue: Nome da fila (default: "jobs")
 */
service.action(
  "list",
  { route: "/schedulers", method: "GET", authRequired: true },
  async (ctx: Context) => {
    const queueName = (ctx.query?.queue as string) || "jobs";
    const queue = service.queue(queueName);
    const schedulers = await queue.getJobSchedulers();

    return {
      queue: queueName,
      count: schedulers.length,
      schedulers: schedulers.map((s) => ({
        key: s.key,
        jobName: s.jobName,
        pattern: s.pattern || null,
        every: s.every ? Number(s.every) : null,
        timezone: s.timezone || null,
        nextRun: new Date(Number(s.nextRun)).toISOString(),
        jobRunCount: s.jobRunCount,
        jobExecutionCount: s.jobExecutionCount,
        limit: s.limit,
        data: s.data, // Already deserialized by SDK
      })),
    };
  },
);

/**
 * DELETE /schedulers/:key
 * Remover um scheduler
 */
service.action(
  "remove",
  { route: "/schedulers/:key", method: "DELETE", authRequired: true },
  async (ctx: Context) => {
    const { key } = ctx.params;
    const queueName = (ctx.query?.queue as string) || "jobs";

    const queue = service.queue(queueName);
    await queue.removeJobScheduler(key);

    console.log(`🗑️  Scheduler removido: ${key} (fila=${queueName})`);

    return {
      success: true,
      queue: queueName,
      message: `Scheduler '${key}' removido com sucesso`,
    };
  },
);

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

setupGracefulShutdown(service);

await service.start();
