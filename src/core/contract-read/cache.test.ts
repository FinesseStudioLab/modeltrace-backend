import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContractReadCache,
  ContractReadEvent,
  ContractReadType,
  createContractReadCache,
} from "./index.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a miss fetches upstream and returns the value with an as-of timestamp", async () => {
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => 0 });
  const result = await cache.read("k", async () => 42);

  assert.equal(result.value, 42);
  assert.equal(result.stale, false);
  assert.equal(result.fromCache, false);
  // The evidence field: exactly when the value was fetched, on every response.
  assert.equal(result.asOf, new Date(0).toISOString());
});

test("a fresh entry is served from the cache without touching upstream", async () => {
  let upstreamCalls = 0;
  let now = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  await cache.read("k", async () => {
    upstreamCalls++;
    return 1;
  });

  now = 500; // still within the 1000ms TTL
  const hit = await cache.read("k", async () => {
    upstreamCalls++;
    return 2;
  });

  assert.equal(hit.value, 1);
  assert.equal(hit.fromCache, true);
  assert.equal(hit.stale, false);
  assert.equal(upstreamCalls, 1);
});

test("an entry past its TTL is refetched", async () => {
  let value = 1;
  let now = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  await cache.read("k", async () => value);
  value = 2;
  now = 1000; // exactly at expiry — not fresh anymore
  const result = await cache.read("k", async () => value);

  assert.equal(result.value, 2);
  assert.equal(result.fromCache, false);
});

test("a hundred concurrent misses produce one upstream call", async () => {
  let upstreamCalls = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => 0 });

  const fetch = async () => {
    upstreamCalls++;
    await delay(20);
    return 7;
  };

  const results = await Promise.all(
    Array.from({ length: 100 }, () => cache.read("k", fetch)),
  );

  // Acceptance criterion: request coalescing verified under concurrent load.
  assert.equal(upstreamCalls, 1);
  for (const result of results) assert.equal(result.value, 7);
  // Coalesced waiters share one fetch, so one as-of for all of them.
  assert.ok(results.every((r) => r.asOf === results[0].asOf));
});

test("an expired entry is served as stale, labelled with its as-of, when upstream fails", async () => {
  let now = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  await cache.read("k", async () => 10);
  now = 2000; // long past TTL
  const result = await cache.read("k", async () => {
    throw new Error("rpc unavailable");
  });

  // The billing-critical shape: the old number is served, but it is explicitly
  // stale and carries the moment it was fetched. A number without an as-of
  // timestamp is not evidence.
  assert.equal(result.value, 10);
  assert.equal(result.stale, true);
  assert.equal(result.asOf, new Date(0).toISOString());
});

test("upstream failure with no cached entry propagates the error", async () => {
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => 0 });
  await assert.rejects(
    () => cache.read("k", async () => {
      throw new Error("rpc unavailable");
    }),
    /rpc unavailable/,
  );
});

test("stale serving can be disabled for paths that cannot act on estimates", async () => {
  let now = 0;
  const cache = new ContractReadCache<number>({
    ttlMs: 1000,
    serveStaleOnError: false,
    now: () => now,
  });

  await cache.read("k", async () => 10);
  now = 2000;
  await assert.rejects(
    () => cache.read("k", async () => {
      throw new Error("rpc unavailable");
    }),
    /rpc unavailable/,
  );
});

test("each read after a stale serving retries upstream rather than serving stale forever", async () => {
  let now = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  await cache.read("k", async () => 10);
  now = 2000;

  let upstreamCalls = 0;
  const failing = async () => {
    upstreamCalls++;
    throw new Error("rpc unavailable");
  };

  const first = await cache.read("k", failing);
  const second = await cache.read("k", failing);
  assert.equal(first.stale, true);
  assert.equal(second.stale, true);
  // The stale result is not cached as fresh, so every read still probes
  // upstream — the service recovers the moment the RPC does.
  assert.equal(upstreamCalls, 2);
});

test("coalesced waiters all receive the same stale result on upstream failure", async () => {
  let now = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  await cache.read("k", async () => 10);
  now = 2000;

  let upstreamCalls = 0;
  const failing = async () => {
    upstreamCalls++;
    throw new Error("rpc unavailable");
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () => cache.read("k", failing)),
  );
  assert.equal(upstreamCalls, 1);
  for (const result of results) {
    assert.equal(result.value, 10);
    assert.equal(result.stale, true);
  }
});

test("invalidate drops the entry so the next read goes upstream", async () => {
  let value = 1;
  let upstreamCalls = 0;
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => 0 });

  await cache.read("k", async () => {
    upstreamCalls++;
    return value;
  });

  // The indexer event path: a write happened on-chain, so do not wait out the
  // TTL — the next read must reflect it.
  cache.invalidate("k");
  value = 2;
  const result = await cache.read("k", async () => {
    upstreamCalls++;
    return value;
  });

  assert.equal(result.value, 2);
  assert.equal(upstreamCalls, 2);
});

test("a read started after invalidate does not join the pre-event fetch", async () => {
  let now = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => now });

  // Fetch 1 is in flight when the indexer event arrives. It may reflect
  // pre-event state, so it must not become the cache's post-event answer.
  const first = cache.read("k", async () => {
    await gate;
    return 1;
  });

  cache.invalidate("k");

  const second = await cache.read("k", async () => 2);
  assert.equal(second.value, 2);

  release();
  assert.equal((await first).value, 1);

  // The pre-event fetch completed late; the cache must still hold the fresh
  // post-event value, not the orphaned one.
  const third = await cache.read("k", async () => {
    throw new Error("must not fetch");
  });
  assert.equal(third.value, 2);
  assert.equal(third.fromCache, true);
});

test("invalidating an unknown key is a no-op", async () => {
  const cache = new ContractReadCache<number>({ ttlMs: 1000, now: () => 0 });
  cache.invalidate("never-read");
  assert.equal(cache.size, 0);
});

test("emits structured events for hits, misses, coalescing, and invalidation", async () => {
  const events: Array<[string, Record<string, unknown>]> = [];
  const cache = new ContractReadCache<number>({
    ttlMs: 1000,
    now: () => 0,
    onEvent: (event, detail) => events.push([event, detail]),
  });

  await cache.read("k", async () => 1);
  await cache.read("k", async () => {
    throw new Error("must be a cache hit");
  });
  cache.invalidate("k");

  const names = events.map(([event]) => event);
  assert.ok(names.includes(ContractReadEvent.FetchStarted));
  assert.ok(names.includes(ContractReadEvent.FetchSucceeded));
  assert.ok(names.includes(ContractReadEvent.CacheHit));
  assert.ok(names.includes(ContractReadEvent.Invalidated));
});

test("stale serving emits the fetch-failed and stale-served events", async () => {
  let now = 0;
  const events: string[] = [];
  const cache = new ContractReadCache<number>({
    ttlMs: 1000,
    now: () => now,
    onEvent: (event) => events.push(event),
  });

  await cache.read("k", async () => 10);
  now = 2000;
  const result = await cache.read("k", async () => {
    throw new Error("rpc unavailable");
  });

  assert.equal(result.stale, true);
  assert.ok(events.includes(ContractReadEvent.FetchFailed));
  assert.ok(events.includes(ContractReadEvent.StaleServed));
});

test("createContractReadCache wires each type to its documented TTL", async () => {
  let now = 0;
  const metadata = createContractReadCache<string>(ContractReadType.Metadata, {
    now: () => now,
  });
  const quota = createContractReadCache<number>(ContractReadType.QuotaBalance, {
    now: () => now,
  });

  await metadata.read("m", async () => "v1");
  await quota.read("q", async () => 5);

  // One millisecond before the metadata TTL (24h): metadata is still fresh,
  // while the quota balance (30s) expired hours ago and must be refetched.
  now = 24 * 60 * 60 * 1000 - 1;
  const meta = await metadata.read("m", async () => "v2");
  const balance = await quota.read("q", async () => 6);

  assert.equal(meta.value, "v1");
  assert.equal(meta.fromCache, true);
  assert.equal(balance.value, 6);
  assert.equal(balance.fromCache, false);
});

test("expired entries are swept once the cache exceeds maxEntries", async () => {
  let now = 0;
  const cache = new ContractReadCache<string>({
    ttlMs: 1000,
    now: () => now,
    maxEntries: 3,
  });

  await cache.read("a", async () => "1");
  await cache.read("b", async () => "2");
  await cache.read("c", async () => "3");

  now = 2000; // a, b, c all expired
  await cache.read("d", async () => "4");

  assert.equal(cache.size, 1);
  const hit = await cache.read("d", async () => {
    throw new Error("must not fetch");
  });
  assert.equal(hit.value, "4");
});
