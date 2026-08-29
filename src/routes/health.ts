import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config/env.js";

export interface ReadinessCheckResult {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

export interface HealthStatusResponse {
  status: "ok" | "unhealthy";
  service: "api";
  checks?: Record<string, ReadinessCheckResult>;
  timestamp: string;
}

let shuttingDown = false;

export function setShuttingDown(val: boolean) {
  shuttingDown = val;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export interface CheckSorobanRpcOptions {
  url?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

let cachedRpcResult: { result: ReadinessCheckResult; timestamp: number } | null = null;

export function resetHealthCache() {
  cachedRpcResult = null;
  shuttingDown = false;
}

export async function checkSorobanRpc(
  opts: CheckSorobanRpcOptions = {},
): Promise<ReadinessCheckResult> {
  const url = opts.url ?? config.stellar.sorobanRpcUrl;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchFn = opts.fetchFn ?? fetch;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: {},
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        status: "error",
        error: `HTTP ${res.status}`,
      };
    }

    const latencyMs = Date.now() - start;
    return {
      status: "ok",
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const msg =
      err?.name === "AbortError"
        ? "RPC request timed out"
        : err?.message || "RPC check failed";
    return {
      status: "error",
      error: msg,
    };
  }
}

export interface HealthRoutesOptions {
  cacheTtlMs?: number;
  rpcTimeoutMs?: number;
  rpcUrl?: string;
  fetchFn?: typeof fetch;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  opts,
) => {
  const cacheTtlMs = opts.cacheTtlMs ?? 5000;

  // Liveness check: process is running. Cheap, no dependencies.
  app.get("/health/live", { config: { public: true } }, async () => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }));

  // Backwards-compatible /health endpoint
  app.get("/health", { config: { public: true } }, async () => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }));

  // Readiness check: dependencies reachability & shutdown state
  app.get(
    "/health/ready",
    { config: { public: true } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const timestamp = new Date().toISOString();

      if (shuttingDown) {
        reply.status(503);
        return {
          status: "unhealthy",
          service: "api",
          checks: {
            server: {
              status: "error",
              error: "server is shutting down",
            },
          },
          timestamp,
        };
      }

      const now = Date.now();
      let rpcCheck: ReadinessCheckResult;

      if (cachedRpcResult && now - cachedRpcResult.timestamp < cacheTtlMs) {
        rpcCheck = cachedRpcResult.result;
      } else {
        rpcCheck = await checkSorobanRpc({
          url: opts.rpcUrl,
          timeoutMs: opts.rpcTimeoutMs,
          fetchFn: opts.fetchFn,
        });
        cachedRpcResult = { result: rpcCheck, timestamp: now };
      }

      const isHealthy = rpcCheck.status === "ok";
      const status = isHealthy ? "ok" : "unhealthy";

      if (!isHealthy) {
        reply.status(503);
      }

      return {
        status,
        service: "api",
        checks: {
          sorobanRpc: rpcCheck,
        },
        timestamp,
      };
    },
  );
};