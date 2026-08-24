import {
  EnvSigningKeyProvider,
  KmsSigningKeyProvider,
  NullSigningKeyProvider,
  type SigningKeyProvider,
} from "./key-provider.js";

export * from "./key-provider.js";
export { redactSecrets, REDACTED } from "./redact.js";

export interface SigningConfig {
  readonly provider: "null" | "kms" | "env";
  readonly kmsKeyId?: string;
  readonly envSecret?: string;
  readonly nodeEnv: string;
}

/**
 * Structured events the alerting rules in ADR 0001 query for. Kept as string
 * literals in one place so a rule is a log query rather than new
 * instrumentation, and so renaming one breaks the build rather than the alert.
 */
export const SigningEvent = {
  ProviderSelected: "signing.provider_selected",
  InterimRiskActive: "signing.interim_risk_active",
  ProductionEnvKeyRefused: "signing.production_env_key_refused",
} as const;

/**
 * Choose the signing provider for this process.
 *
 * Refuses rather than downgrades. A misconfigured deployment that silently
 * falls back to a weaker custody model is worse than one that will not start:
 * the second is noticed in seconds, the first is noticed after an incident.
 */
export function resolveSigningKeyProvider(
  config: SigningConfig,
  log: (event: string, detail: Record<string, unknown>) => void,
): SigningKeyProvider {
  const isProduction = config.nodeEnv === "production";

  if (config.provider === "env") {
    // The interim risk documented in ADR 0001 has an explicit boundary, and
    // this is where the boundary is enforced. Not a warning — a refusal.
    if (isProduction) {
      log(SigningEvent.ProductionEnvKeyRefused, {
        reason:
          "SIGNING_PROVIDER=env is not permitted when NODE_ENV=production (ADR 0001)",
      });
      throw new Error(
        "SIGNING_PROVIDER=env is not permitted in production; use SIGNING_PROVIDER=kms (see docs/adr/0001-soroban-signing-key-custody.md)",
      );
    }

    if (!config.envSecret) {
      throw new Error(
        "SIGNING_PROVIDER=env requires SIGNING_ENV_SECRET_KEY to be set",
      );
    }

    // Loud on every start, so the interim risk cannot quietly become permanent
    // by nobody noticing it is still on.
    log(SigningEvent.InterimRiskActive, {
      provider: "env",
      risk: "signing key held in an environment variable",
      owner: "backend maintainers",
      expires: "before any deployment that signs against a public network",
      adr: "docs/adr/0001-soroban-signing-key-custody.md",
    });
    return new EnvSigningKeyProvider(config.envSecret);
  }

  if (config.provider === "kms") {
    if (!config.kmsKeyId) {
      throw new Error("SIGNING_PROVIDER=kms requires SIGNING_KMS_KEY_ID to be set");
    }
    log(SigningEvent.ProviderSelected, { provider: "kms" });
    return new KmsSigningKeyProvider(config.kmsKeyId);
  }

  log(SigningEvent.ProviderSelected, { provider: "null" });
  return new NullSigningKeyProvider();
}
