import { describe, it, expect, afterAll } from "bun:test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

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

describe("Scheduled Jobs Integration", async () => {
  const serviceAvailable = await isServiceAvailable();

  if (!serviceAvailable) {
    it.skip("Service not available - start the API with 'bun run dev'", () => {});
    return;
  }

  const createdSchedulerKeys: string[] = [];

  afterAll(async () => {
    if (!ACCESS_TOKEN) return;

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

  describe("Health Check", () => {
    it("GET /health should return service status", async () => {
      const response = await fetch(`${BASE_URL}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("scheduler-api");
    });
  });

  if (!ACCESS_TOKEN) {
    it.skip("ACCESS_TOKEN não configurado - pulando testes autenticados", () => {});
    return;
  }

  describe("Scheduler CRUD", () => {
    it("POST /schedulers should create a scheduler with 'every' interval", async () => {
      const schedulerKey = `test-every-${Date.now()}`;
      createdSchedulerKeys.push(schedulerKey);

      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          every: 60000,
          jobName: "ProcessData",
          data: { message: "Test message" },
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.schedulerKey).toBe(schedulerKey);
      expect(data.nextRun).toBeDefined();
      expect(data.nextRunMs).toBeGreaterThan(Date.now());
    });

    it("POST /schedulers should create a scheduler with cron pattern", async () => {
      const schedulerKey = `test-cron-${Date.now()}`;
      createdSchedulerKeys.push(schedulerKey);

      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          pattern: "0 9 * * *",
          jobName: "GenerateReport",
          data: { type: "daily" },
          timezone: "America/Sao_Paulo",
        }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.schedulerKey).toBe(schedulerKey);
    });

    it("GET /schedulers should list all schedulers", async () => {
      const response = await fetch(`${BASE_URL}/schedulers`, {
        headers: withAuth(),
      });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.schedulers)).toBe(true);
    });

    it("DELETE /schedulers/:key should remove a scheduler", async () => {
      const schedulerKey = `test-delete-${Date.now()}`;

      await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey,
          every: 60000,
          jobName: "Cleanup",
          data: {},
        }),
      });

      const response = await fetch(`${BASE_URL}/schedulers/${schedulerKey}`, {
        method: "DELETE",
        headers: withAuth(),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain(schedulerKey);
    });
  });

  describe("Validation", () => {
    it("POST /schedulers should reject when neither pattern nor every is provided", async () => {
      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey: "invalid-test",
          jobName: "ProcessData",
          data: {},
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("POST /schedulers should reject when both pattern and every are provided", async () => {
      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey: "invalid-test-2",
          pattern: "0 9 * * *",
          every: 60000,
          jobName: "ProcessData",
          data: {},
        }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("POST /schedulers should reject empty schedulerKey", async () => {
      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey: "",
          every: 60000,
          jobName: "ProcessData",
          data: {},
        }),
      });

      expect(response.status).toBe(422);
    });

    it("POST /schedulers should reject negative interval", async () => {
      const response = await fetch(`${BASE_URL}/schedulers`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          schedulerKey: "negative-test",
          every: -1000,
          jobName: "ProcessData",
          data: {},
        }),
      });

      expect(response.status).toBe(422);
    });
  });
});
