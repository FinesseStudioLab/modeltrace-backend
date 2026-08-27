import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

Object.assign(process.env, {
  NODE_ENV: "test",
  PORT: "8080",
  API_PREFIX: "/api/v1",
  CORS_ORIGIN: "http://localhost:3000",
  STELLAR_NETWORK: "testnet",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  AUDIT_REGISTRY_CONTRACT_ID: validContractId,
  USAGE_METER_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  PAYMENT_ROUTER_CONTRACT_ID: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  SIGNING_PROVIDER: "null",
});

const { healthRoutes, resetHealthCache, setShuttingDown } = await import(
  "./health.js"
);

beforeEach(() => {
  resetHealthCache();
});

test("GET /health/live returns HTTP 200 with liveness status", async () => {
  const app = Fastify();
  await app.register(healthRoutes);

  const res = await app.inject({
    method: "GET",
    url: "/health/live",
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "api");
  assert.ok(body.timestamp);
});

test("GET /health returns HTTP 200 for backwards compatibility", async () => {
  const app = Fastify();
  await app.register(healthRoutes);

  const res = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "api");
  assert.ok(body.timestamp);
});

test("GET /health/ready returns HTTP 200 when Soroban RPC is healthy", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { status: "healthy" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const app = Fastify();
  await app.register(healthRoutes, { fetchFn: mockFetch });

  const res = await app.inject({
    method: "GET",
    url: "/health/ready",
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "api");
  assert.equal(body.checks.sorobanRpc.status, "ok");
  assert.ok(typeof body.checks.sorobanRpc.latencyMs === "number");
});

test("GET /health/ready caches RPC check result within TTL", async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { status: "healthy" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const app = Fastify();
  await app.register(healthRoutes, { fetchFn: mockFetch, cacheTtlMs: 5000 });

  const res1 = await app.inject({ method: "GET", url: "/health/ready" });
  const res2 = await app.inject({ method: "GET", url: "/health/ready" });

  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  assert.equal(calls, 1, "RPC fetch should be called only once due to caching");
});

test("GET /health/ready returns HTTP 503 when Soroban RPC fails", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "Internal Error" }), {
      status: 500,
    });

  const app = Fastify();
  await app.register(healthRoutes, { fetchFn: mockFetch });

  const res = await app.inject({
    method: "GET",
    url: "/health/ready",
  });

  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "unhealthy");
  assert.equal(body.checks.sorobanRpc.status, "error");
  assert.equal(body.checks.sorobanRpc.error, "HTTP 500");
});

test("GET /health/ready returns HTTP 503 when Soroban RPC times out", async () => {
  const mockFetch: typeof fetch = async (url, init) => {
    return new Promise((_, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };

  const app = Fastify();
  await app.register(healthRoutes, { fetchFn: mockFetch, rpcTimeoutMs: 10 });

  const res = await app.inject({
    method: "GET",
    url: "/health/ready",
  });

  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "unhealthy");
  assert.equal(body.checks.sorobanRpc.status, "error");
  assert.equal(body.checks.sorobanRpc.error, "RPC request timed out");
});

test("GET /health/ready returns HTTP 503 during graceful shutdown", async () => {
  setShuttingDown(true);

  const app = Fastify();
  await app.register(healthRoutes);

  const res = await app.inject({
    method: "GET",
    url: "/health/ready",
  });

  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.status, "unhealthy");
  assert.equal(body.checks.server.status, "error");
  assert.equal(body.checks.server.error, "server is shutting down");
});