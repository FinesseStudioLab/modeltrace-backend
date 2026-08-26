import { CircuitBreaker } from "./circuitBreaker.js";
import {
  SorobanContractError,
  SorobanSimulationError,
  SorobanTransportError,
} from "./errors.js";
import { retryWithBackoff, withTimeout } from "./retry.js";

/**
 * Minimal JSON-RPC transport over the Soroban RPC endpoint. Kept to the raw
 * `fetch` protocol rather than the full `@stellar/stellar-sdk` so this
 * client stays small and its failure modes stay easy to mock in tests —
 * the SDK's higher-level transaction builders can sit on top of this later
 * without changing the retry/timeout/circuit-breaking behavior here.
 */
export interface RpcTransport {
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
}

export class HttpRpcTransport implements RpcTransport {
  constructor(private readonly url: string) {}

  async call<T>(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal,
      });
    } catch (err) {
      throw new SorobanTransportError(`request to ${method} failed`, err);
    }

    if (res.status === 429 || res.status >= 500) {
      throw new SorobanTransportError(`${method} returned HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new SorobanTransportError(`${method} returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (body.error) {
      throw new SorobanTransportError(
        `${method} RPC error ${body.error.code}: ${body.error.message}`,
      );
    }
    return body.result as T;
  }
}

export interface SimulateResult {
  transactionData: string;
  minResourceFee: string;
  cost: unknown;
}

export interface SubmitResult {
  hash: string;
  status: "PENDING";
}

export type TransactionStatus =
  | { status: "SUCCESS"; hash: string; returnValue?: unknown }
  | { status: "FAILED"; hash: string; error: string }
  | { status: "NOT_FOUND"; hash: string };

export interface SorobanClientOptions {
  transport: RpcTransport;
  timeouts?: {
    simulateMs?: number;
    submitMs?: number;
    pollMs?: number;
  };
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  circuitBreaker?: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
  };
  /** Bound on total wall-clock time spent polling for confirmation. */
  confirmationBudgetMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Thin, resilient wrapper around Soroban RPC. Read/simulate/poll operations
 * are idempotent and go through retry + circuit breaking. Submission is
 * never retried by this client — a caller who wants "did my transaction
 * make it?" after a submit failure must poll for the hash, exactly like a
 * caller recovering from a crash would.
 */
export class SorobanClient {
  private readonly circuit: CircuitBreaker;
  private readonly timeouts: Required<NonNullable<SorobanClientOptions["timeouts"]>>;
  private readonly retryOpts: Required<NonNullable<SorobanClientOptions["retry"]>>;
  private readonly confirmationBudgetMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SorobanClientOptions) {
    this.circuit = new CircuitBreaker({
      name: "soroban-rpc",
      failureThreshold: opts.circuitBreaker?.failureThreshold ?? 5,
      resetTimeoutMs: opts.circuitBreaker?.resetTimeoutMs ?? 30_000,
    });
    this.timeouts = {
      simulateMs: opts.timeouts?.simulateMs ?? 10_000,
      submitMs: opts.timeouts?.submitMs ?? 10_000,
      pollMs: opts.timeouts?.pollMs ?? 5_000,
    };
    this.retryOpts = {
      maxAttempts: opts.retry?.maxAttempts ?? 4,
      baseDelayMs: opts.retry?.baseDelayMs ?? 200,
      maxDelayMs: opts.retry?.maxDelayMs ?? 3_000,
    };
    this.confirmationBudgetMs = opts.confirmationBudgetMs ?? 30_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Idempotent: safe to retry. */
  async simulate(transactionXdr: string): Promise<SimulateResult> {
    return this.circuit.exec(() =>
      retryWithBackoff(
        () =>
          withTimeout("simulate", this.timeouts.simulateMs, () =>
            this.opts.transport.call<SimulateResult>("simulateTransaction", {
              transaction: transactionXdr,
            }),
          ),
        this.retryOpts,
      ),
    );
  }

  /**
   * Submits an already-signed transaction. **Not retried.** If this throws
   * due to a transport error, the caller does not know whether the network
   * received it — the correct recovery is `pollUntilConfirmed`, not calling
   * submit again.
   */
  async submit(signedTransactionXdr: string): Promise<SubmitResult> {
    return withTimeout("submit", this.timeouts.submitMs, () =>
      this.opts.transport.call<SubmitResult>("sendTransaction", {
        transaction: signedTransactionXdr,
      }),
    );
  }

  /** Idempotent read, safe to retry and to circuit-break. */
  async getTransactionStatus(hash: string): Promise<TransactionStatus> {
    return this.circuit.exec(() =>
      retryWithBackoff(
        () =>
          withTimeout("getTransaction", this.timeouts.pollMs, () =>
            this.opts.transport.call<TransactionStatus>("getTransaction", { hash }),
          ),
        this.retryOpts,
      ),
    );
  }

  /**
   * Bounded poll loop from submission to terminal status. This is the
   * *only* recovery path for a submit whose result is unknown — including
   * after a process restart, since polling by hash is naturally idempotent.
   */
  async pollUntilConfirmed(hash: string): Promise<TransactionStatus> {
    const deadline = Date.now() + this.confirmationBudgetMs;
    for (;;) {
      const status = await this.getTransactionStatus(hash);
      if (status.status !== "NOT_FOUND") return status;
      if (Date.now() >= deadline) {
        throw new SorobanTransportError(
          `transaction ${hash} not confirmed within ${this.confirmationBudgetMs}ms`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Full flow: simulate → (caller assembles + signs) → submit → poll.
   * Assembly/signing is intentionally left to the caller — this client
   * doesn't hold key material (see ADR 0001 on signing custody).
   */
  async submitAndConfirm(signedTransactionXdr: string): Promise<TransactionStatus> {
    const { hash } = await this.submit(signedTransactionXdr);
    const status = await this.pollUntilConfirmed(hash);
    if (status.status === "FAILED") {
      throw new SorobanContractError(status.error, hash);
    }
    return status;
  }
}

export { SorobanTransportError, SorobanSimulationError, SorobanContractError };
