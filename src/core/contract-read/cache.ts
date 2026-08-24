/**
 * TTL cache for contract reads.
 *
 * Implements the policy in `docs/adr/0002-contract-read-caching.md`. The four
 * behaviours the issue asks for:
 *
 * 1. **Per-type TTLs** — each `ContractReadCache` instance is constructed with
 *    one TTL, so the cache for metadata and the cache for quota balances can
 *    never accidentally share a policy. `createContractReadCache` (in
 *    `index.ts`) wires the instance to the documented TTL table.
 * 2. **Event-driven invalidation** — `invalidate(key)` drops the entry (and
 *    detaches any in-flight fetch) so the next read goes upstream. Indexer
 *    event handlers call this instead of waiting for the TTL to expire.
 * 3. **Stale-on-failure** — when upstream fails and an entry exists, the entry
 *    is served with `stale: true` and an `asOf` timestamp. The label is not
 *    decoration: a number without an as-of time is not evidence in a billing
 *    dispute. Every stale serving is also emitted as a structured event so it
 *    shows up in logs/alerts, not just in the response.
 * 4. **Request coalescing** — concurrent misses for the same key share a single
 *    in-flight upstream call (single-flight). A hundred dashboard polls that
 *    miss together produce one RPC call, not a hundred.
 *
 * The cache is keyed by a caller-built string. The caller is responsible for
 * encoding everything that distinguishes one read from another (contract id,
 * method, arguments) into the key — two different reads sharing a key would
 * silently share a value, and that mistake is the one thing this class cannot
 * detect.
 */

/** The shape returned to callers for every read, fresh or stale. */
export interface CachedRead<T> {
  /** The value. Identical shape whether served fresh or stale. */
  value: T;

  /**
   * ISO-8601 timestamp of when the value was fetched from the chain. Present
   * on every response — this is the evidence field, see ADR 0002.
   */
  asOf: string;

  /**
   * `true` only when upstream failed and this value is being served past its
   * TTL. A caller that cannot act on stale numbers (e.g. a write path) must
   * check this flag; a caller that can (a dashboard) must surface it.
   */
  stale: boolean;

  /**
   * `true` when served from the cache without touching upstream. Useful for
   * observability; not part of the correctness contract.
   */
  fromCache: boolean;
}

export interface ContractReadCacheOptions {
  /** How long a fetched value is considered fresh. See `types.ts` for policy. */
  readonly ttlMs: number;

  /**
   * Serve an expired entry when upstream fails, labelled `stale: true`.
   * Defaults to `true` — the issue's failure mode is "whole service degrading
   * because one feature's RPC reads fail", and a labelled stale number keeps
   * that feature up. Set to `false` when even a labelled estimate is worse
   * than an error (e.g. the input to a write path).
   */
  readonly serveStaleOnError?: boolean;

  /**
   * Structured events, in the same style as the signing module's logger
   * (`event: "contract_read.*"`). Alerting rules are log queries; emitting
   * here keeps that property without coupling the cache to Fastify.
   */
  readonly onEvent?: (event: string, detail: Record<string, unknown>) => void;

  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number;

  /**
   * Soft cap on cached entries. When exceeded, expired entries are swept so a
   * cache cannot grow without bound on a misbehaving key space. Pure
   * bookkeeping — eviction never changes correctness, only TTL expiry and
   * `invalidate` do.
   */
  readonly maxEntries?: number;
}

/**
 * Structured events emitted via `onEvent`. Kept as string literals in one
 * place so an alerting rule is a log query and so renaming one breaks the
 * build rather than the dashboard.
 */
export const ContractReadEvent = {
  CacheHit: "contract_read.cache_hit",
  Coalesced: "contract_read.coalesced",
  FetchStarted: "contract_read.fetch_started",
  FetchSucceeded: "contract_read.fetch_succeeded",
  FetchFailed: "contract_read.fetch_failed",
  StaleServed: "contract_read.stale_served",
  Invalidated: "contract_read.invalidated",
} as const;

interface Entry<T> {
  readonly value: T;
  readonly fetchedAt: number;
  /** Monotonic per-key counter; bumped by `invalidate`. */
  readonly epoch: number;
}

interface FetchResult<T> {
  readonly value: T;
  readonly fetchedAt: number;
  readonly stale: boolean;
}

const DEFAULT_MAX_ENTRIES = 10_000;

export class ContractReadCache<T> {
  private readonly ttlMs: number;
  private readonly serveStaleOnError: boolean;
  private readonly onEvent: (event: string, detail: Record<string, unknown>) => void;
  private readonly now: () => number;
  private readonly maxEntries: number;

  private readonly entries = new Map<string, Entry<T>>();
  /** Single-flight handle per key. May resolve to a stale result on failure. */
  private readonly inFlight = new Map<string, Promise<FetchResult<T>>>();
  private readonly epochs = new Map<string, number>();

  constructor(options: ContractReadCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.serveStaleOnError = options.serveStaleOnError ?? true;
    this.onEvent = options.onEvent ?? (() => {});
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Read `key`, fetching through `fetch` on a miss.
   *
   * Returns the cached value when it is fresh, joins the in-flight fetch when
   * one is already running for `key` (coalescing), or starts a new upstream
   * call. When the upstream call fails and `serveStaleOnError` is on, an
   * expired entry is returned with `stale: true`; the error itself is emitted
   * as an event and swallowed, so a degraded dashboard does not take the whole
   * service down.
   */
  async read(key: string, fetch: () => Promise<T>): Promise<CachedRead<T>> {
    const now = this.now();
    const epoch = this.epochs.get(key) ?? 0;
    const entry = this.entries.get(key);

    if (entry !== undefined && entry.epoch === epoch && now < entry.fetchedAt + this.ttlMs) {
      this.onEvent(ContractReadEvent.CacheHit, {
        key,
        ttlMs: this.ttlMs,
        ageMs: now - entry.fetchedAt,
      });
      return {
        value: entry.value,
        asOf: new Date(entry.fetchedAt).toISOString(),
        stale: false,
        fromCache: true,
      };
    }

    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      this.onEvent(ContractReadEvent.Coalesced, { key });
      return this.toCachedRead(await existing);
    }

    this.onEvent(ContractReadEvent.FetchStarted, { key, ttlMs: this.ttlMs });

    const promise = this.runFetch(key, epoch, entry, fetch);
    this.inFlight.set(key, promise);

    try {
      return this.toCachedRead(await promise);
    } finally {
      // Only detach the handle we actually own: a concurrent `invalidate`
      // bumps the epoch and replaces this handle, and must not be undone by
      // the fetch finishing late.
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  /**
   * Drop the cached value for `key` and detach any in-flight fetch, so the
   * next read goes upstream. Indexer event handlers call this on the event
   * that corresponds to the write, instead of waiting out the TTL.
   *
   * A fetch already in flight is not cancelled — JavaScript cannot cancel a
   * promise — but it is orphaned: its result is returned to the callers who
   * joined it before the invalidation, and is *not* stored, because it may
   * reflect pre-event state. New readers start a fresh fetch. The TTL remains
   * the backstop if an indexer event is ever missed.
   */
  invalidate(key: string): void {
    const epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    this.entries.delete(key);
    this.inFlight.delete(key);
    this.onEvent(ContractReadEvent.Invalidated, { key, epoch });
  }

  /** Number of currently stored entries, for tests and observability. */
  get size(): number {
    return this.entries.size;
  }

  private async runFetch(
    key: string,
    epoch: number,
    expired: Entry<T> | undefined,
    fetch: () => Promise<T>,
  ): Promise<FetchResult<T>> {
    try {
      const value = await fetch();
      const fetchedAt = this.now();

      // Guard against storing a result that a concurrent invalidation has
      // declared stale (epoch bumped while the fetch was in flight). The value
      // is still returned to whoever waited for it — they asked before the
      // event — but it must not become the cache's answer to post-event reads.
      if (epoch === (this.epochs.get(key) ?? 0)) {
        this.store(key, epoch, value, fetchedAt);
      }

      this.onEvent(ContractReadEvent.FetchSucceeded, { key, fetchedAt });
      return { value, fetchedAt, stale: false };
    } catch (err) {
      this.onEvent(ContractReadEvent.FetchFailed, {
        key,
        error: err instanceof Error ? err.message : String(err),
      });

      if (expired !== undefined && expired.epoch === epoch && this.serveStaleOnError) {
        this.onEvent(ContractReadEvent.StaleServed, {
          key,
          ageMs: this.now() - expired.fetchedAt,
          asOf: new Date(expired.fetchedAt).toISOString(),
        });
        return {
          value: expired.value,
          fetchedAt: expired.fetchedAt,
          stale: true,
        };
      }

      throw err;
    }
  }

  private store(key: string, epoch: number, value: T, fetchedAt: number): void {
    this.entries.set(key, { value, fetchedAt, epoch });

    // Opportunistic sweep so an unbounded key space cannot grow the map
    // without limit. This is bookkeeping only: entries past their TTL are
    // never served as fresh regardless of whether they are still in the map.
    if (this.entries.size > this.maxEntries) {
      this.sweepExpired();
    }
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.fetchedAt + this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }

  private toCachedRead(result: FetchResult<T>): CachedRead<T> {
    return {
      value: result.value,
      asOf: new Date(result.fetchedAt).toISOString(),
      stale: result.stale,
      fromCache: false,
    };
  }
}
