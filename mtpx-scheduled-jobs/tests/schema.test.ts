import { describe, expect, it } from "bun:test";
import { createJobSchema, createSchedulerSchema } from "../src/schemas.js";

describe("Scheduled Jobs Schemas", () => {
  it("createJobSchema aceita payload arbitrario em data sem erro interno", () => {
    const result = createJobSchema.parse({
      name: "ProcessData",
      data: {
        message: "ok",
        count: 1,
        nested: { valid: true },
        values: [1, 2, 3],
      },
    });

    expect(result.queue).toBe("jobs");
    expect(result.name).toBe("ProcessData");
    expect(result.data).toEqual({
      message: "ok",
      count: 1,
      nested: { valid: true },
      values: [1, 2, 3],
    });
    expect(result.delay).toBe(0);
    expect(result.priority).toBe(0);
    expect(result.attempts).toBe(3);
  });

  it("createSchedulerSchema aceita payload arbitrario em data sem erro interno", () => {
    const result = createSchedulerSchema.parse({
      schedulerKey: "daily-report",
      every: 60000,
      jobName: "GenerateReport",
      data: {
        type: "daily",
        options: { region: "br" },
      },
    });

    expect(result.schedulerKey).toBe("daily-report");
    expect(result.queue).toBe("jobs");
    expect(result.every).toBe(60000);
    expect(result.jobName).toBe("GenerateReport");
    expect(result.data).toEqual({
      type: "daily",
      options: { region: "br" },
    });
  });
});
