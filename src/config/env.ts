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

  // Authentication — issue #42.
  JWT_SECRET: z.string().min(32),
  API_KEY_STORE: z.string().default("[]"),
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

/**
 * Describes a single validation issue without ever echoing the value that
 * was provided — environment variables routinely hold secrets, and even a
 * "non-secret" one (a URL with embedded credentials, say) isn't something
 * to gamble on. `invalid_enum_value` is the one Zod issue code whose
 * default `.message` includes the offending value verbatim ("received
 * 'x'"), so it gets a synthesized message instead; every other code used by
 * this schema (invalid_type, invalid_string, and our own `custom` issues)
 * already keeps its default message value-free.
 */
function describeIssue(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return `must be one of: ${issue.options.join(", ")}`;
  }
  return issue.message;
}

/** Renders a ZodError as a readable, per-variable list — never a raw JSON dump. */
function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `  - ${path}: ${describeIssue(issue)}`;
  });
  return [
    "Invalid environment configuration:",
    ...lines,
    "",
    "Fix the variable(s) above and restart. Values are never logged.",
  ].join("\n");
}

export function parseEnv(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

/**
 * Loads and validates the environment, exiting the process with a readable
 * message on failure rather than letting a ZodError propagate as an
 * uncaught exception (a raw stack trace and a wall of JSON, printed before
 * any logger exists). `process.exit` is typed `never`, so control flow
 * analysis knows the catch branch never falls through to a missing return.
 */
function loadEnv(): z.infer<typeof envSchema> {
  try {
    return parseEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return process.exit(1);
  }
}

let _config: ReturnType<typeof parseEnv> | null = null;

export function getConfig(): ReturnType<typeof parseEnv> {
  if (!_config) {
    _config = parseEnv(process.env);
  }
  return _config;
}
const raw = loadEnv();

export const config = {
  get nodeEnv() { return getConfig().NODE_ENV; },
  get port() { return getConfig().PORT; },
  get apiPrefix() { return getConfig().API_PREFIX; },
  get corsOrigin() { return resolveCorsOrigins(getConfig().CORS_ORIGIN, getConfig().NODE_ENV); },
  get stellar() {
    return {
      network: getConfig().STELLAR_NETWORK,
      sorobanRpcUrl: getConfig().SOROBAN_RPC_URL,
      contracts: {
        auditRegistry: getConfig().AUDIT_REGISTRY_CONTRACT_ID,
        usageMeter: getConfig().USAGE_METER_CONTRACT_ID,
        paymentRouter: getConfig().PAYMENT_ROUTER_CONTRACT_ID,
      },
    };
  },
  get signing() {
    return {
      provider: getConfig().SIGNING_PROVIDER,
      kmsKeyId: getConfig().SIGNING_KMS_KEY_ID,
      envSecret: getConfig().SIGNING_ENV_SECRET_KEY,
      nodeEnv: getConfig().NODE_ENV,
    };
  },
  get rateLimit() {
    return {
      max: getConfig().RATE_LIMIT_MAX,
      windowMs: getConfig().RATE_LIMIT_WINDOW_MS,
    };
  },
  get bodyLimitBytes() { return getConfig().BODY_LIMIT_BYTES; },
  get auth() {
    return {
      jwtSecret: getConfig().JWT_SECRET,
      apiKeyStore: getConfig().API_KEY_STORE,
    };
  },
};

/**
 * The resolved *effective* configuration, with the one field that is
 * genuinely secret material (the interim env-var signing key, never the
 * KMS key id — that's a reference, not the key itself) redacted. Logged at
 * boot so an operator can confirm what the process actually loaded, rather
 * than reconstructing it from a dozen environment variables by hand.
 */
export function redactedConfig(): Record<string, unknown> {
  return {
    ...config,
    signing: {
      ...config.signing,
      envSecret: config.signing.envSecret ? "[redacted]" : undefined,
    },
  };
}

// Skipped under NODE_ENV=test so importing this module in a test file — every
// test in this repo does — doesn't spam the console on every run.
if (config.nodeEnv !== "test") {
  console.log("Resolved configuration:", JSON.stringify(redactedConfig(), null, 2));
}
