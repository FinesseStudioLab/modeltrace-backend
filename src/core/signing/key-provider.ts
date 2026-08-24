/**
 * Signing key custody.
 *
 * The decision this file implements is written up in
 * `docs/adr/0001-soroban-signing-key-custody.md`. In short: this service never
 * signs anything that moves value. Settlement is returned to the caller as an
 * unsigned envelope. The only key that may exist here is a low-privilege
 * attestation key, scoped on-chain to attestation entry points.
 *
 * Every provider below implements one interface whose defining property is what
 * it does *not* have: there is no way to read the key. A call site can ask for a
 * signature and nothing else, so key material cannot be logged, serialized into
 * an error, or forwarded to a downstream service by accident.
 */

/** What a key is permitted to authorize. Enforced on-chain; declared here so
 *  the service can refuse locally before spending a round trip. */
export type SigningScope = "attestation";

export interface SigningKeyProvider {
  /** Identifies the provider in logs and alerts. Never the key itself. */
  readonly kind: "null" | "kms" | "env";

  /** The scopes this key may authorize. */
  readonly scopes: readonly SigningScope[];

  /**
   * Sign `payload` for `scope`.
   *
   * Implementations must reject a scope outside `scopes` before signing rather
   * than relying on the contract to refuse — the on-chain check is the
   * guarantee, this one is the alert.
   */
  sign(payload: Uint8Array, scope: SigningScope): Promise<Uint8Array>;

  /** Public key, for verification and for confirming a rotation cut over. */
  publicKey(): Promise<string>;
}

/**
 * Raised for every signing failure. The underlying provider error is logged
 * through the redacting serializer and deliberately not attached here: this
 * error can reach an HTTP response, and provider errors have a habit of quoting
 * the input they failed on.
 */
export class SigningUnavailableError extends Error {
  constructor(reason: string) {
    super(`signing unavailable: ${reason}`);
    this.name = "SigningUnavailableError";
  }
}

export class ScopeViolationError extends Error {
  constructor(scope: string) {
    super(`signing scope not permitted: ${scope}`);
    this.name = "ScopeViolationError";
  }
}

/**
 * The default. Every signing attempt throws.
 *
 * A service that cannot sign is the correct state until attestation writes
 * exist, and it is the state we want any misconfiguration to fall back to.
 * "Signing quietly started working because someone set an env var in staging"
 * is the failure this default is here to prevent.
 */
export class NullSigningKeyProvider implements SigningKeyProvider {
  readonly kind = "null" as const;
  readonly scopes: readonly SigningScope[] = [];

  async sign(_payload: Uint8Array, _scope: SigningScope): Promise<Uint8Array> {
    throw new SigningUnavailableError(
      "no signing key is configured; this service does not sign value movement (see docs/adr/0001)",
    );
  }

  async publicKey(): Promise<string> {
    throw new SigningUnavailableError("no signing key is configured");
  }
}

/**
 * Production custody. Signing happens inside the KMS; the key never enters this
 * process's memory, so a heap dump, a core file, or an RCE yields nothing
 * signable beyond the window in which the credential is valid.
 *
 * The integration lands with the attestation PR — the interface is fixed now so
 * that call sites are written against it from the start, and so that swapping
 * the implementation in is not also a refactor of everything that signs.
 */
export class KmsSigningKeyProvider implements SigningKeyProvider {
  readonly kind = "kms" as const;
  readonly scopes: readonly SigningScope[] = ["attestation"];

  constructor(private readonly keyId: string) {}

  async sign(_payload: Uint8Array, scope: SigningScope): Promise<Uint8Array> {
    if (!this.scopes.includes(scope)) throw new ScopeViolationError(scope);
    throw new SigningUnavailableError(
      `KMS provider is not yet integrated (key ${this.keyId})`,
    );
  }

  async publicKey(): Promise<string> {
    throw new SigningUnavailableError("KMS provider is not yet integrated");
  }
}

/**
 * Local development only, and an explicitly documented interim risk.
 *
 * Reading a key from an environment variable puts it in the process
 * environment, in `/proc`, in any crash dump, and in whatever orchestrator
 * config seeded it. That is not acceptable in production, so selecting this
 * provider under `NODE_ENV=production` is a startup failure rather than a
 * warning — see `resolveSigningKeyProvider`.
 */
export class EnvSigningKeyProvider implements SigningKeyProvider {
  readonly kind = "env" as const;
  readonly scopes: readonly SigningScope[] = ["attestation"];

  constructor(private readonly secret: string) {}

  async sign(_payload: Uint8Array, scope: SigningScope): Promise<Uint8Array> {
    if (!this.scopes.includes(scope)) throw new ScopeViolationError(scope);
    throw new SigningUnavailableError(
      "attestation signing is not implemented yet",
    );
  }

  async publicKey(): Promise<string> {
    throw new SigningUnavailableError(
      "attestation signing is not implemented yet",
    );
  }

  /** Present so the unused-field check does not tempt anyone into exposing it. */
  get configured(): boolean {
    return this.secret.length > 0;
  }
}
