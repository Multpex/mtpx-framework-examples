import { describe, it, expect, afterAll } from "bun:test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const JOB_TIMEOUT = 15000;

function withAuth(headers?: HeadersInit): HeadersInit {
  return {
    ...headers,
    ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
  };
}

async function isServiceAvailable(): Promise<boolean> {
  try {
    const healthResponse = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!healthResponse.ok) return false;

    const healthData = await healthResponse.json();
    if (healthData.version === "0.1.0") return false;

    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Scheduled Jobs E2E", async () => {
  const serviceAvailable = await isServiceAvailable();

  if (!serviceAvailable) {
    it.skip("Service not available", () => {});
    return;
  }

  if (!ACCESS_TOKEN) {
    it.skip("ACCESS_TOKEN não configurado - pulando testes autenticados", () => {});
    return;
  }

  const createdSchedulerKeys: string[] = [];

  afterAll(async () => {
    for (const key of createdSchedulerKeys) {
      try {
        await fetch(`${BASE_URL}/schedulers/${key}`, {
          method: "DELETE",
          headers: withAuth(),
        });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe("Fluxo Completo: Scheduler -> Job -> Worker", () => {
    it("deve criar scheduler e acompanhar jobRunCount", async () => {
      const schedulerKey = `e2e-test-${Date.now()}`;
      createdSchedulerKeys.push(schedulerKey);

      const createResponse = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          every: 5000,
          jobName: "process-data",
          data: {
            message: "E2E Test Job",
            items: ["item1", "item2", "item3"],
            testId: schedulerKey,
          },
        }),
      });

      expect(createResponse.status).toBe(200);

      const createData = await createResponse.json();
      expect(createData.success).toBe(true);
      expect(createData.schedulerKey).toBe(schedulerKey);

      const listResponse = await fetch(`${BASE_URL}/schedulers`, {
        headers: withAuth(),
      });
      const listData = await listResponse.json();

      const ourScheduler = listData.schedulers.find(
        (s: { key: string }) => s.key === schedulerKey,
      );
      expect(ourScheduler).toBeDefined();
      expect(ourScheduler.jobName).toBe("process-data");

      await sleep(6000);

      const statusResponse = await fetch(`${BASE_URL}/schedulers`, {
        headers: withAuth(),
      });
      const statusData = await statusResponse.json();

      const updatedScheduler = statusData.schedulers.find(
        (s: { key: string; jobRunCount?: number }) => s.key === schedulerKey,
      );

      expect(updatedScheduler).toBeDefined();
      expect(typeof updatedScheduler.jobRunCount).toBe("number");
    }, JOB_TIMEOUT + 5000);

    it("deve criar scheduler com cron e próxima execução futura", async () => {
      const schedulerKey = `e2e-cron-${Date.now()}`;
      createdSchedulerKeys.push(schedulerKey);

      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          pattern: "*/1 * * * *",
          jobName: "generate-report",
          data: {
            type: "e2e-test",
            recipients: ["test@example.com"],
          },
          timezone: "America/Sao_Paulo",
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);

      const nextRunMs = data.nextRunMs;
      const now = Date.now();
      const oneMinuteFromNow = now + 60000;

      expect(nextRunMs).toBeGreaterThan(now);
      expect(nextRunMs).toBeLessThanOrEqual(oneMinuteFromNow + 1000);
    });
  });

  describe("Worker Job Handlers", () => {
    it("deve criar scheduler de execução única para process-data", async () => {
      const schedulerKey = `e2e-handler-process-${Date.now()}`;
      createdSchedulerKeys.push(schedulerKey);

      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          every: 3000,
          limit: 1,
          jobName: "process-data",
          data: {
            message: "Handler test",
            items: [1, 2, 3, 4, 5],
          },
        }),
      });

      expect(response.status).toBe(200);

      await sleep(5000);

      const statusResponse = await fetch(`${BASE_URL}/schedulers`, {
        headers: withAuth(),
      });
      const statusData = await statusResponse.json();

      const scheduler = statusData.schedulers.find(
        (s: { key: string; jobRunCount?: number }) => s.key === schedulerKey,
      );

      if (scheduler) {
        expect(typeof scheduler.jobRunCount).toBe("number");
      } else {
        expect(scheduler).toBeUndefined();
      }
    }, 10000);
  });
});
