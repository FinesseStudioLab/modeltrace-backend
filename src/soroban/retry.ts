import { SorobanTimeoutError } from "./errors.js";

export interface RetryOptions {
  /** Max attempts including the first — must be >= 1. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exponential backoff with full jitter, for **idempotent** operations only
 * (reads, simulation, polling). Never wrap a raw transaction submission in
 * this — retrying a submit can double-send. Submission uses
 * `pollUntilConfirmed` instead, which polls by hash rather than resubmitting.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === opts.maxAttempts) break;
      const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay = random() * cap;
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Wraps a promise-returning call with a hard timeout. The abort signal is
 * handed to `fn` so a fetch-based implementation can cancel the underlying
 * request, but the timeout guarantee itself does not depend on `fn`
 * cooperating — it's enforced by racing against a timer, so a call that
 * ignores the signal still returns (with a timeout error) instead of
 * hanging forever.
 */
export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SorobanTimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
