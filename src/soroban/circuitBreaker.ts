import { CircuitOpenError } from "./errors.js";

type State = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  name: string;
  /** Consecutive failures before tripping open. */
  failureThreshold: number;
  /** How long to stay open before allowing one trial call. */
  resetTimeoutMs: number;
  now?: () => number;
}

/**
 * A sustained RPC outage should fail fast rather than pile up queued
 * requests behind a dead endpoint. Closed = calls pass through normally.
 * Open = calls fail immediately with CircuitOpenError. Half-open = one
 * trial call is allowed through; success closes the circuit, failure
 * reopens it.
 */
export class CircuitBreaker {
  private state: State = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  getState(): State {
    if (this.state === "open" && this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
      return "half-open";
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.getState();
    if (current === "open") {
      throw new CircuitOpenError(this.opts.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.consecutiveFailures += 1;
    if (this.state === "half-open" || this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}
