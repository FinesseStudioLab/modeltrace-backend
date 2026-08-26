import assert from "node:assert/strict";
import { test } from "node:test";
import { CircuitOpenError, SorobanTimeoutError, SorobanTransportError } from "./errors.js";
import { SorobanClient, type RpcTransport } from "./client.js";

function immediateSleep() {
  return Promise.resolve();
}

function fixedRandom() {
  return 0; // no delay in tests
}

test("simulate retries transient transport errors and eventually succeeds", async () => {
  let calls = 0;
  const transport: RpcTransport = {
    call: async <T>() => {
      calls++;
      if (calls < 3) throw new SorobanTransportError("boom");
      return { transactionData: "x", minResourceFee: "1", cost: {} } as T;
    },
  };
  const client = new SorobanClient({
    transport,
    sleep: immediateSleep,
    retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 },
  });

  const result = await client.simulate("dummy-xdr");
  assert.equal(calls, 3);
  assert.equal(result.minResourceFee, "1");
});

test("simulate times out when the transport hangs", async () => {
  const transport: RpcTransport = {
    call: () => new Promise(() => {}), // never resolves
  };
  const client = new SorobanClient({
    transport,
    sleep: immediateSleep,
    timeouts: { simulateMs: 5 },
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });

  await assert.rejects(client.simulate("dummy-xdr"), SorobanTimeoutError);
});

test("circuit breaker opens after repeated failures and fails fast", async () => {
  const transport: RpcTransport = {
    call: async () => {
      throw new SorobanTransportError("down");
    },
  };
  const client = new SorobanClient({
    transport,
    sleep: immediateSleep,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 100_000 },
  });

  await assert.rejects(client.getTransactionStatus("h1"), SorobanTransportError);
  await assert.rejects(client.getTransactionStatus("h2"), SorobanTransportError);
  // Third call should fail fast via the open circuit, not hit the transport.
  await assert.rejects(client.getTransactionStatus("h3"), CircuitOpenError);
});

test("submit is never retried by the client itself", async () => {
  let calls = 0;
  const transport: RpcTransport = {
    call: async (method) => {
      if (method === "sendTransaction") {
        calls++;
        throw new SorobanTransportError("transient send failure");
      }
      throw new Error("unexpected method " + method);
    },
  };
  const client = new SorobanClient({ transport, sleep: immediateSleep });

  await assert.rejects(client.submit("signed-xdr"), SorobanTransportError);
  assert.equal(calls, 1, "submit must not be retried internally");
});

test("pollUntilConfirmed treats a 429-then-recover getTransaction as one logical poll", async () => {
  let calls = 0;
  const transport: RpcTransport = {
    call: async <T>(method: string) => {
      if (method === "getTransaction") {
        calls++;
        if (calls === 1) throw new SorobanTransportError("429");
        if (calls < 3) return { status: "NOT_FOUND", hash: "abc" } as T;
        return { status: "SUCCESS", hash: "abc" } as T;
      }
      throw new Error("unexpected");
    },
  };
  const client = new SorobanClient({
    transport,
    sleep: immediateSleep,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    pollIntervalMs: 0,
    confirmationBudgetMs: 5_000,
  });

  const result = await client.pollUntilConfirmed("abc");
  assert.equal(result.status, "SUCCESS");
});

void fixedRandom;
