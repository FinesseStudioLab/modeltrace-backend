/**
 * Secret redaction for anything that reaches the log stream.
 *
 * ADR 0001 requires that key material never appear in source, logs, or error
 * output. Call sites are not trusted to remember that: a secret reaches the
 * logger by being nested three levels deep in a config dump or hanging off a
 * thrown error's context, not by someone typing `log.info(secretKey)`. So the
 * redaction runs over whole objects at the serializer boundary, which is the
 * one place every log line has to pass through.
 */

/** Substituted for any value judged secret. Fixed length so it leaks nothing. */
export const REDACTED = "[redacted]";

/**
 * Key names whose values are always replaced. Matched case-insensitively
 * against the whole key, and as a substring, so `SIGNING_SECRET_KEY` and
 * `stellarSecret` are both caught.
 */
const SECRET_KEY_PATTERNS = [
  "secret",
  "privatekey",
  "private_key",
  "signingkey",
  "signing_key",
  "seed",
  "mnemonic",
  "passphrase",
  "password",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "credential",
] as const;

/**
 * Stellar secret seeds are `S` followed by 55 base32 characters. Matching the
 * shape as well as the key name catches the case that matters most: a secret
 * that arrived under an innocuous name, or inside a free-text error message.
 */
const STELLAR_SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function redactString(value: string): string {
  return value.replace(STELLAR_SECRET_SEED, REDACTED);
}

/**
 * Deep-copy `value` with secrets removed.
 *
 * Cycles are tolerated (a Fastify error can reference the request that produced
 * it) and depth is capped, because a serializer that throws or hangs takes the
 * log line — and often the request — with it. Failing open to `[unserializable]`
 * is the right trade: a missing log entry is recoverable, a leaked key is not.
 */
export function redactSecrets(value: unknown, maxDepth = 8): unknown {
  return walk(value, maxDepth, new WeakSet<object>());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "[truncated]";

  const object = value as object;
  if (seen.has(object)) return "[circular]";
  seen.add(object);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth - 1, seen));
  }

  // Errors carry their interesting fields on the prototype and as non-enumerable
  // properties, so a plain spread loses the message and keeps nothing useful.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : walk(nested, depth - 1, seen);
  }
  return out;
}
