/**
 * Typed error taxonomy for Soroban RPC calls. Callers need to branch on
 * *why* a call failed — a transport hiccup is retryable, a simulation
 * failure means the transaction is wrong, and a contract error means the
 * chain rejected it on purpose. Collapsing these into one Error subclass
 * (or worse, a string) forces every caller to re-derive that distinction
 * from a message string.
 */

export class SorobanTransportError extends Error {
  readonly kind = "transport" as const;
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SorobanTransportError";
  }
}

export class SorobanTimeoutError extends SorobanTransportError {
  constructor(readonly operation: string, readonly timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "SorobanTimeoutError";
  }
}

export class SorobanSimulationError extends Error {
  readonly kind = "simulation" as const;
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SorobanSimulationError";
  }
}

export class SorobanContractError extends Error {
  readonly kind = "contract" as const;
  constructor(
    message: string,
    readonly contractCode?: number | string,
  ) {
    super(message);
    this.name = "SorobanContractError";
  }
}

export class CircuitOpenError extends Error {
  readonly kind = "circuit-open" as const;
  constructor(readonly circuit: string) {
    super(`circuit "${circuit}" is open — failing fast`);
    this.name = "CircuitOpenError";
  }
}

export type SorobanError =
  | SorobanTransportError
  | SorobanTimeoutError
  | SorobanSimulationError
  | SorobanContractError
  | CircuitOpenError;
