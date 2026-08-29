import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { registerAuthHooks } from "./auth/plugin.js";
import { generateApiKey, resolveAuthProvider } from "./auth/provider.js";
import { createTestAuthProvider } from "./auth/testing.js";
import { buildServer } from "./index.js";

const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.API_PREFIX = "/api/v1";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.STELLAR_NETWORK = "testnet";
process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.AUDIT_REGISTRY_CONTRACT_ID = validContractId;
process.env.USAGE_METER_CONTRACT_ID = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
process.env.PAYMENT_ROUTER_CONTRACT_ID = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
process.env.SIGNING_PROVIDER = "null";
process.env.RATE_LIMIT_MAX = "100";
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.BODY_LIMIT_BYTES = "1048576";
process.env.JWT_SECRET = "dev-secret-32-characters-long!!!";
process.env.API_KEY_STORE = "[]";

const JWT_SECRET = process.env.JWT_SECRET;

async function buildApp(opts: { rateLimitMax?: number; bodyLimitBytes?: number } = {}) {
  const app = await buildServer({
    rateLimit: opts.rateLimitMax !== undefined ? { max: opts.rateLimitMax } : undefined,
    bodyLimitBytes: opts.bodyLimitBytes,
  });
  await app.ready();
  return app;
}

function gatewayAuth(entry: ReturnType<typeof generateApiKey>["entry"]) {
  return resolveAuthProvider({ jwtSecret: JWT_SECRET, apiKeyStore: [entry] });
}

test("rate limit rejects requests above the configured threshold", async () => {
  const app = await buildApp({ rateLimitMax: 2 });

  const first = await app.inject({ method: "GET", url: "/health" });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: "GET", url: "/health" });
  assert.equal(second.statusCode, 200);

  const blocked = await app.inject({ method: "GET", url: "/health" });
  assert.equal(blocked.statusCode, 429);
  const body = blocked.json();
  assert.equal(body.error, "Too Many Requests");
  assert.equal(body.message, "rate limit exceeded");

  await app.close();
});

test("body limit rejects payloads larger than the configured size", async () => {
  const { key, entry } = generateApiKey("gateway-prod", ["dispute:write"]);
  const auth = gatewayAuth(entry);
  const app = await buildServer({ bodyLimitBytes: 64, auth });
  await app.ready();

  const bigPayload = "x".repeat(128);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/disputes",
    headers: {
      authorization: `ApiKey ${key}`,
      "x-role": "buyer",
      "content-type": "application/json",
    },
    payload: JSON.stringify({ content: bigPayload }),
  });

  assert.equal(res.statusCode, 413);

  await app.close();
});

test("small payloads within the body limit are accepted", async () => {
  const { key, entry } = generateApiKey("gateway-prod", ["dispute:write"]);
  const auth = gatewayAuth(entry);
  const app = await buildServer({ bodyLimitBytes: 4096, auth });
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/disputes",
    headers: {
      authorization: `ApiKey ${key}`,
      "x-role": "buyer",
      "content-type": "application/json",
    },
    payload: JSON.stringify({
      settlementId: "s1",
      reason: "item not delivered",
      buyerId: "buyer-1",
      sellerId: "seller-1",
    }),
  });

  assert.equal(res.statusCode, 201);

  await app.close();
});

test("health endpoints are public and do not require credentials", async () => {
  const app = await buildApp();

  const live = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(live.statusCode, 200);

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  await app.close();
});

test("/api/v1/meta is public", async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/api/v1/meta" });
  assert.equal(res.statusCode, 200);

  await app.close();
});

test("protected routes reject unauthenticated requests", async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/api/v1/disputes" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "unauthorized");

  await app.close();
});

test("protected routes accept a valid gateway API key", async () => {
  const { key, entry } = generateApiKey("gateway-prod", ["dispute:read"]);
  const auth = gatewayAuth(entry);
  const app = await buildServer({ auth });
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/disputes",
    headers: {
      authorization: `ApiKey ${key}`,
      "x-role": "adjudicator",
    },
  });

  assert.equal(res.statusCode, 200);

  await app.close();
});

test("protected routes accept a valid operator bearer token", async () => {
  const app = await buildServer();
  await app.ready();

  const token = await app.auth.issueOperatorToken("operator-1", ["dispute:read"]);
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/disputes",
    headers: {
      authorization: `Bearer ${token}`,
      "x-role": "adjudicator",
    },
  });

  assert.equal(res.statusCode, 200);

  await app.close();
});

test("protected routes enforce scopes", async () => {
  const { key, entry } = generateApiKey("gateway-prod", ["meta:read"]);
  const auth = gatewayAuth(entry);
  const app = await buildServer({ auth });
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/api/v1/disputes",
    headers: {
      authorization: `ApiKey ${key}`,
      "x-role": "adjudicator",
    },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "insufficient scope");

  await app.close();
});

test("routes without explicit public opt-in are denied by default", async () => {
  const auth = createTestAuthProvider();
  const app = Fastify();
  app.decorate("auth", auth);
  registerAuthHooks(app, auth);
  app.get("/hidden", async () => "ok");
  await app.ready();

  const denied = await app.inject({ method: "GET", url: "/hidden" });
  assert.equal(denied.statusCode, 401);

  const allowed = await app.inject({
    method: "GET",
    url: "/hidden",
    headers: { "x-test-auth": "user,meta:read" },
  });
  assert.equal(allowed.statusCode, 200);

  await app.close();
});
