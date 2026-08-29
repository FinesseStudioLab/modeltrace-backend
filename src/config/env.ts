import "dotenv/config";
import { z } from "zod";

const contractId = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, "must be a Soroban contract ID");

const DEV_DEFAULT_ORIGIN = "http://localhost:3000";

const baseEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  API_PREFIX: z.string().default("/api/v1"),
  // No default: a CORS default that's fine in development and silently
  // persists into production is how this becomes a real vulnerability.
  // Comma-separated so a preview deployment and production can each have
  // their own origin(s) at once. Required outright in production —
  // enforced below rather than here, since the requirement is conditional
  // on NODE_ENV.
  CORS_ORIGIN: z.string().optional(),
  STELLAR_NETWORK: z.enum(["testnet", "futurenet", "mainnet"]),
  SOROBAN_RPC_URL: z.string().url(),
  AUDIT_REGISTRY_CONTRACT_ID: contractId,
  USAGE_METER_CONTRACT_ID: contractId,
  PAYMENT_ROUTER_CONTRACT_ID: contractId,

  // Signing key custody — see docs/adr/0001-soroban-signing-key-custody.md.
  // Defaults to "null": this service cannot sign until something deliberately
  // configures it to, and it never signs value movement at all.
  SIGNING_PROVIDER: z.enum(["null", "kms", "env"]).default("null"),
  SIGNING_KMS_KEY_ID: z.string().optional(),
  SIGNING_ENV_SECRET_KEY: z.string().optional(),

  // Operational guardrails — issue #43.
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  BODY_LIMIT_BYTES: z.coerce.number().default(1048576),
});

/** Exposed separately so callers that need `.shape` (e.g. tests) can get at
 * it — `envSchema` itself is a refined schema and no longer exposes it. */
export { baseEnvSchema };

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;

  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGIN"],
      message: "CORS_ORIGIN must be set explicitly in production — no default is allowed.",
    });
    return;
  }

  if (parseCorsOrigins(env.CORS_ORIGIN).includes("*")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGIN"],
      message: 'CORS_ORIGIN may not be "*" in production.',
    });
  }
});

/** Splits a comma-separated origin list into trimmed, non-empty entries. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function resolveCorsOrigins(raw: string | undefined, nodeEnv: string): string[] {
  const parsed = parseCorsOrigins(raw);
  // Production requires an explicit, non-wildcard value — already enforced
  // by envSchema at parse time, so reaching here with an empty list means
  // we're outside production and can fall back to the dev default.
  return parsed.length > 0 ? parsed : [DEV_DEFAULT_ORIGIN];
}

export function parseEnv(env: NodeJS.ProcessEnv) {
  return envSchema.parse(env);
}

const raw = parseEnv(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  corsOrigin: resolveCorsOrigins(raw.CORS_ORIGIN, raw.NODE_ENV),
  stellar: {
    network: raw.STELLAR_NETWORK,
    sorobanRpcUrl: raw.SOROBAN_RPC_URL,
    contracts: {
      auditRegistry: raw.AUDIT_REGISTRY_CONTRACT_ID,
      usageMeter: raw.USAGE_METER_CONTRACT_ID,
      paymentRouter: raw.PAYMENT_ROUTER_CONTRACT_ID,
    },
  },
  signing: {
    provider: raw.SIGNING_PROVIDER,
    kmsKeyId: raw.SIGNING_KMS_KEY_ID,
    envSecret: raw.SIGNING_ENV_SECRET_KEY,
    nodeEnv: raw.NODE_ENV,
  },
  rateLimit: {
    max: raw.RATE_LIMIT_MAX,
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
  },
  bodyLimitBytes: raw.BODY_LIMIT_BYTES,
};
