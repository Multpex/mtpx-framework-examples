import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sign } from "jsonwebtoken";

const BASE_URL = process.env.BASE_URL || "http://localhost:3999";
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-for-jwt-signing";

function generateToken(
  role: "user" | "admin",
  options?: { expiresIn?: string }
): string {
  const payload = {
    sub: `test-${role}-id`,
    roles: [role],
    permissions: role === "admin" ? ["items:delete", "admin:access"] : ["items:read"],
  };

  return sign(payload, JWT_SECRET, { expiresIn: options?.expiresIn || "1h" });
}

async function isServiceAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/minimal-app/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

describe("Minimal Service Integration", async () => {
  const serviceAvailable = await isServiceAvailable();

  if (!serviceAvailable) {
    it.skip("Service not available - start with MOCK_MODE=false", () => {});
    return;
  }

  describe("Health Checks", () => {
    it("GET /health should return service health status", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("healthy");
      expect(data.service).toBe("minimal-app");
      expect(data.checks).toBeDefined();
    });

    it("GET /ready should return readiness status", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/ready`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("ready");
    });

    it("GET /live should return liveness status", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/live`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("alive");
    });
  });

  describe("CRUD Operations", () => {
    it("GET /items should list all items", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/items`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.items).toBeDefined();
      expect(Array.isArray(data.items)).toBe(true);
    });

    it("GET /items/:id should get item by ID", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/items/1`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe("1");
      expect(data.name).toBeDefined();
      expect(data.price).toBeDefined();
    });

    it("GET /items/:id should return 404 for non-existent item", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/items/non-existent-id`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe("Not found");
    });

    it("POST /items should create new item with valid data", async () => {
      const userToken = generateToken("user");
      const newItem = {
        name: "Test Item",
        price: 49.99,
        tags: ["test", "integration"],
      };

      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(newItem),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.name).toBe(newItem.name);
      expect(data.price).toBe(newItem.price);
      expect(data.tags).toEqual(newItem.tags);
    });
  });

  describe("Validation", () => {
    it("POST /items should return validation error for missing name", async () => {
      const userToken = generateToken("user");
      const invalidItem = { price: 10 };

      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(invalidItem),
      });

      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.type).toBe("VALIDATION");
      // New readable format: "name: Required" instead of escaped JSON
      expect(data.error.message).toContain("name");
    });

    it("POST /items should return validation error for negative price", async () => {
      const userToken = generateToken("user");
      const invalidItem = { name: "Test", price: -10 };

      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(invalidItem),
      });

      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error.type).toBe("VALIDATION");
      expect(data.error.message.toLowerCase()).toMatch(/price|positive|number/);
    });

    it("POST /items should return validation error for empty name", async () => {
      const userToken = generateToken("user");
      const invalidItem = { name: "", price: 10 };

      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(invalidItem),
      });

      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error.type).toBe("VALIDATION");
    });

    it("POST /items should return validation error for name too long", async () => {
      const userToken = generateToken("user");
      const invalidItem = { name: "x".repeat(101), price: 10 };

      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(invalidItem),
      });

      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error.type).toBe("VALIDATION");
    });
  });

  describe("Authentication", () => {
    it("POST /items should return 401 without token", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "No Auth", price: 10 }),
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.type).toBe("UNAUTHORIZED");
    });

    it("DELETE /items/:id should return 401 without token", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/items/1`, {
        method: "DELETE",
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.type).toBe("UNAUTHORIZED");
    });

    it("DELETE /items/:id should return 403 with user token (not admin)", async () => {
      const userToken = generateToken("user");

      const response = await fetch(`${BASE_URL}/minimal-app/items/1`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${userToken}` },
      });

      expect(response.status).toBe(403);

      const data = await response.json();
      expect(data.error.type).toBe("FORBIDDEN");
    });

    it("DELETE /items/:id should succeed with admin token", async () => {
      const userToken = generateToken("user");
      const createResponse = await fetch(`${BASE_URL}/minimal-app/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ name: "To Delete", price: 1 }),
      });

      const createdItem = await createResponse.json();
      const adminToken = generateToken("admin");

      const deleteResponse = await fetch(`${BASE_URL}/minimal-app/items/${createdItem.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(deleteResponse.status).toBe(200);

      const data = await deleteResponse.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Admin Group", () => {
    it("GET /admin/stats should return 401 without token", async () => {
      const response = await fetch(`${BASE_URL}/minimal-app/admin/stats`);
      expect(response.status).toBe(401);
    });

    it("GET /admin/stats should return 403 with user token", async () => {
      const userToken = generateToken("user");

      const response = await fetch(`${BASE_URL}/minimal-app/admin/stats`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });

      expect(response.status).toBe(403);
    });

    it("GET /admin/stats should succeed with admin token", async () => {
      const adminToken = generateToken("admin");

      const response = await fetch(`${BASE_URL}/minimal-app/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.totalItems).toBeDefined();
      expect(data.totalValue).toBeDefined();
      expect(typeof data.totalItems).toBe("number");
      expect(typeof data.totalValue).toBe("number");
    });
  });
});
