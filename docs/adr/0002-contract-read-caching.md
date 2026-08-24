# ADR 0002 — Contract read caching

- **Status:** Accepted
- **Date:** 2026-08-24
- **Milestone:** M2 — Meter and report
- **Supersedes:** nothing (first decision on this axis)

## Context

Contract state reads go over Soroban RPC. RPC is slow relative to an in-process
read and, on a public endpoint, rate-limited. A dashboard polling quotas for a
hundred payers will exhaust a public RPC endpoint's budget immediately — and
because reads share one upstream, the failure mode is the whole service
degrading rather than one feature being slow.

The two kinds of state this service reads sit at opposite ends of the staleness
spectrum:

| | Contract metadata | Quota balances |
|---|---|---|
| How often it changes | Effectively never — set at deployment, changed only by a deliberate migration | Every metered batch |
| Cost of being wrong | Low (schema drift, cosmetic) | High — it is what a billing dispute is about |
| Read frequency | Low (bootstrap, occasional) | High (dashboard polling, per request) |

And one constraint dominates the design: this is a billing product. **A number
without an as-of timestamp is not evidence.** Silently serving an old number is
worse than serving an error, because the consumer cannot tell which happened.
Any scheme that serves cached data must therefore say, on every response, when
the value was fetched — and must say loudly when the value is being served past
its freshness window.

## Options considered

### 1. No cache

Every read goes to RPC. Correct, simple, and the current state — which is also
the failure the issue describes. The service has no headroom against rate
limits, so one misconfigured poller degrades everything. Rejected: the problem
statement is precisely this failure.

### 2. Naive TTL cache

Cache every read with one TTL and serve it until expiry. Cheap and effective at
cutting RPC volume, but:

- A single TTL serves both data types badly: 30 seconds on metadata is
  pointless overhead; 24 hours on quota balances makes a billing dashboard
  display numbers a dispute would laugh at.
- It waits out the TTL even when the indexer already knows the state changed.
- On upstream failure it either errors (taking the dashboard down, the original
  failure) or serves silently stale data (worse than an error in a billing
  dispute).

Rejected as a complete design; its pieces (TTL expiry, a value store) are
retained.

### 3. Per-type TTL cache with event invalidation, labelled staleness, and single-flight coalescing

One cache per data type, each with a TTL chosen for that type's change rate.
Indexer events invalidate the affected keys instead of waiting out the TTL.
Upstream failure serves the last known value only when it is explicitly labelled
stale with its as-of time. Concurrent misses for the same key share one upstream
call so the RPC budget is spent per distinct value, not per poller.

**Accepted.**

## Decision

**Contract reads go through `ContractReadCache` (`src/core/contract-read/`), one
instance per data type.**

### Per-type TTLs

| Type | TTL | Reasoning |
|---|---|---|
| `metadata` | 24h | Immutable in practice. The only way it changes is a contract migration, which is a deploy-time event that can carry an explicit invalidation — the TTL is a backstop, not the mechanism. A short TTL would tax the read path for a change that happens monthly at most. |
| `quota-balance` | 30s | Changes on every metered batch, so any cached value is an estimate; the on-chain record is authoritative and the contract enforces it. 30s keeps a hundred-payer dashboard at ~3 RPC calls/s at steady state instead of a request per poll, while staying short enough that a dispute over a mid-session number is settled by the on-chain record, not by the cache. |

TTLs are defined once in `src/core/contract-read/types.ts`, next to the
reasoning, and `createContractReadCache` binds a type to its TTL so a new read
type must pick a TTL in the same breath it is added.

### Event-driven invalidation

Indexer events are the write signal the cache must not ignore. When an event for
a key arrives, the handler calls `invalidate(key)`; the next read goes upstream.
Invalidation also detaches any in-flight fetch so a read started *after* the
event cannot join a fetch that began *before* it. A fetch already awaited by
callers still resolves for them (they asked before the event), but its result is
not stored. The TTL remains the backstop for indexer events that are missed,
replayed, or late.

### Stale responses are explicit, never silent

On upstream failure, an expired entry is served with:

- `stale: true` — the consumer must treat the number as an estimate, and a
  write path must refuse it;
- `asOf` — an ISO-8601 timestamp of when the value was fetched, present on
  **every** response, fresh or stale. This is the evidence field: a cached
  number in a billing dispute is only as good as the moment it claims to
  represent.

Every stale serving also emits a structured `contract_read.stale_served` event
so the degradation is visible in logs and alerting, not only in the response
payload. Serving stale is the default (`serveStaleOnError: true`) because the
issue's failure mode is whole-service degradation; a path that cannot act on
estimates — e.g. the input to a write — constructs its cache with
`serveStaleOnError: false` and gets the error instead.

### Request coalescing

Concurrent misses for the same key share one in-flight upstream call
(single-flight). A hundred dashboard polls that miss together produce one RPC
call; a thousand produce one. The guarantee is per key, and the key is
caller-built — the caller encodes everything that distinguishes a read
(contract id, method, arguments) into the key, because two reads sharing a key
would silently share a value.

## Consequences

**Accepted costs.** A cached quota balance is never the authoritative number —
it is an estimate with an as-of time, and the contract remains the source of
truth at write time. This is a deliberate trade: the cache exists to keep the
service up and the RPC budget intact, not to make the number authoritative.
Bounded staleness (30s) plus labelled as-of is the honest middle.

**What this buys.** Dashboard polling for a hundred payers is ~3 RPC calls/s at
steady state instead of a request per poll; RPC failure degrades one feature to
explicitly-labelled estimates instead of taking the whole service down; and
every number the API serves carries the evidence a billing dispute needs.

**What is still open.** There is no RPC client or indexer consumer yet — this
ADR defines the caching layer they will use, and the usage shape is sketched in
`src/core/contract-read/index.ts`. TTLs are code constants; env-var overrides
(and per-tenant TTL tuning) can land with the first real consumer if operators
need them.
