// Simple JWT generator (HS256)
function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function createHmacSignature(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Buffer.from(signature)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateJwt(payload: object, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await createHmacSignature(signingInput, secret);
  return `${signingInput}.${signature}`;
}

// Get secret from env or use default (for testing only!)
const secret = process.env.LINKD_JWT_SECRET || "test-secret";
const role = process.argv[2] || "user";

const payload = {
  sub: "user-123",
  tenant_id: "tenant-1",
  roles: role === "admin" ? ["admin"] : ["user"],
  permissions: ["read", "write"],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
};

const token = await generateJwt(payload, secret);

console.log(`\n🔑 JWT Token (${role}):\n`);
console.log(token);
console.log(`\n📋 Payload:\n`);
console.log(JSON.stringify(payload, null, 2));
console.log(`\n🧪 Test with:\n`);
console.log(`curl -X DELETE http://localhost:3999/minimal-app/items/1 \\
  -H "Authorization: Bearer ${token}"`);
console.log("");
