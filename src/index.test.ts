import assert from "node:assert/strict";
import { test } from "node:test";

const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function setBaseEnv() {
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
}

async function buildApp(opts: { rateLimitMax?: number; bodyLimitBytes?: number } = {}) {
  setBaseEnv();
  process.env.RATE_LIMIT_MAX = "100";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  process.env.BODY_LIMIT_BYTES = "1048576";

  const { buildServer } = await import("./index.js");
  const app = await buildServer({
    rateLimit: opts.rateLimitMax !== undefined ? { max: opts.rateLimitMax } : undefined,
    bodyLimitBytes: opts.bodyLimitBytes,
  });
  await app.ready();
  return app;
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
  const app = await buildApp({ bodyLimitBytes: 64 });

  const bigPayload = "x".repeat(128);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/disputes",
    headers: {
      "x-role": "buyer",
      "x-user-id": "buyer-1",
      "content-type": "application/json",
    },
    payload: JSON.stringify({ content: bigPayload }),
  });

  assert.equal(res.statusCode, 413);

  await app.close();
});

test("small payloads within the body limit are accepted", async () => {
  const app = await buildApp({ bodyLimitBytes: 4096 });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/disputes",
    headers: {
      "x-role": "buyer",
      "x-user-id": "buyer-1",
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
