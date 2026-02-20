/**
 * Scheduled Jobs Example - Worker
 *
 * Este arquivo demonstra como processar jobs agendados.
 * O Worker define O QUE FAZER quando receber um job.
 *
 * A API (index.ts) define QUANDO criar jobs na fila.
 */

import {
  createApp,
  JobHandler,
  setupGracefulShutdown,
} from "@multpex/typescript-sdk";

// ============================================================================
// Job Result (tipo padronizado de retorno)
// ============================================================================

interface JobResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// Job Handlers (cada classe = um job)
// ============================================================================

class ProcessData extends JobHandler<
  { message?: string; items?: unknown[] },
  JobResult
> {
  async handle() {
    console.log(
      `   📊 [ProcessData] job='${this.job.name}' id='${this.job.id}' - Processando dados...`,
    );
    await sleep(500);

    const itemCount = this.data.items?.length ?? 1;
    console.log(
      `   📊 [ProcessData] job='${this.job.name}' id='${this.job.id}' - ${itemCount} item(s) processado(s)`,
    );

    return {
      success: true,
      message: `${itemCount} item(s) processado(s)`,
      data: { processed: itemCount },
    };
  }
}

class GenerateReport extends JobHandler<
  { type: string; recipients?: string[] },
  JobResult
> {
  async handle() {
    console.log(
      `   📄 [GenerateReport] job='${this.job.name}' id='${this.job.id}' - Gerando relatório: ${this.data.type}`,
    );
    await sleep(1000);

    const reportId = crypto.randomUUID().slice(0, 8);
    console.log(`   📄 Relatório gerado: ${reportId}`);

    if (this.data.recipients?.length) {
      console.log(`   📧 Enviando para: ${this.data.recipients.join(", ")}`);
    }

    return {
      success: true,
      message: `Relatório ${this.data.type} gerado`,
      data: { reportId, type: this.data.type },
    };
  }
}

class SendNotification extends JobHandler<
  { userId?: string; channel?: string; message?: string },
  JobResult
> {
  async handle() {
    const channel = this.data.channel ?? "push";
    console.log(
      `   🔔 [SendNotification] job='${this.job.name}' id='${this.job.id}' - Enviando notificação via ${channel}`,
    );
    await sleep(300);

    const userId = this.data.userId ?? "all";
    console.log(`   🔔 Notificação enviada para user ${userId}`);

    return {
      success: true,
      message: `Notificação enviada via ${channel}`,
      data: { sent: true, channel, userId },
    };
  }
}

class Cleanup extends JobHandler<
  { olderThanDays?: number; table?: string },
  JobResult
> {
  async handle() {
    const days = this.data.olderThanDays ?? 30;
    const table = this.data.table ?? "logs";

    console.log(
      `   🧹 [Cleanup] job='${this.job.name}' id='${this.job.id}' - Limpando registros de '${table}' com mais de ${days} dias`,
    );
    await sleep(800);

    const deleted = Math.floor(Math.random() * 100);
    console.log(`   🧹 ${deleted} registros removidos`);

    return {
      success: true,
      message: `${deleted} registros removidos de ${table}`,
      data: { deleted, table, olderThanDays: days },
    };
  }
}

class TestJob extends JobHandler<unknown, JobResult> {
  async handle() {
    console.log(
      `   🧪 [TestJob] job='${this.job.name}' id='${this.job.id}' - executado com data:`,
      this.data,
    );
    await sleep(100);
    return {
      success: true,
      message: "Test job completed",
      data: { test: true },
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = process.env.QUEUE_NAME || "jobs";

// ============================================================================
// Service Setup
// ============================================================================

const service = createApp({
  name: "scheduler-worker",
  health: { enabled: false },
  queue: { defaultQueue: QUEUE_NAME },
});

// Registrar handlers usando o nome da classe como job name
service.job(ProcessData);
service.job(GenerateReport);
service.job(SendNotification);
service.job(Cleanup);
service.job(TestJob);

service.beforeStart(async () => {
  console.log("⏳ Iniciando Worker de jobs agendados...");
});

service.afterStart(async () => {
  console.log("✅ Worker pronto! Aguardando jobs...");
  console.log(`📦 Fila: ${QUEUE_NAME}`);
  console.log(
    "🧩 Jobs registrados: ProcessData, GenerateReport, SendNotification, Cleanup, TestJob",
  );
});

// ============================================================================
// Startup
// ============================================================================

setupGracefulShutdown(service);

await service.start();
