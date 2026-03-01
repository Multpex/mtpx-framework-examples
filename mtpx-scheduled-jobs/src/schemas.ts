import { z } from "@multpex/sdk-typescript";

export const JOB_NAMES = [
  "ProcessData",
  "GenerateReport",
  "SendNotification",
  "Cleanup",
  "TestJob",
] as const;

export const createJobSchema = z.object({
  // Nome da fila (default: "jobs")
  queue: z.string().min(1).max(100).default("jobs"),
  // Nome do job (o worker usa isso para decidir o que fazer)
  name: z.enum(JOB_NAMES),
  // Zod 4 requires explicit key and value schemas for record()
  data: z.record(z.string(), z.unknown()).default({}),
  // Delay em ms antes de executar (0 = imediato)
  delay: z.number().int().min(0).default(0),
  // Prioridade (maior = mais prioritário)
  priority: z.number().int().min(0).default(0),
  // Número de tentativas em caso de falha
  attempts: z.number().int().min(1).default(3),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const createSchedulerSchema = z.object({
  schedulerKey: z.string().min(1).max(100),
  // Nome da fila (default: "jobs")
  queue: z.string().min(1).max(100).default("jobs"),
  // Cron pattern (ex: "0 9 * * *") - mutualmente exclusivo com 'every'
  pattern: z.string().optional(),
  // Intervalo em ms (ex: 60000 = 1 min) - mutualmente exclusivo com 'pattern'
  every: z.number().positive().optional(),
  // Nome do job (o worker usa isso para decidir o que fazer)
  jobName: z.enum(JOB_NAMES),
  // Zod 4 requires explicit key and value schemas for record()
  data: z.record(z.string(), z.unknown()).default({}),
  // Timezone para cron (ex: "America/Sao_Paulo")
  timezone: z.string().optional(),
  // Limite de execuções (0 = ilimitado)
  limit: z.number().int().min(0).optional(),
});

export type CreateSchedulerInput = z.infer<typeof createSchedulerSchema>;
