import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type {
  ApiKeyEntry,
  AuthProvider,
  AuthProviderConfig,
  AuthScope,
  AuthenticatedIdentity,
} from "./types.js";

const API_KEY_PREFIX = "mt";
const TOKEN_TYPE_API_KEY = "ApiKey";
const TOKEN_TYPE_BEARER = "Bearer";

export { API_KEY_PREFIX };

/**
 * Hash an API key secret with a per-key salt. Returns base64 strings ready to
 * store in the API_KEY_STORE env variable.
 */
export function hashApiKeySecret(secret: string, salt?: Buffer) {
  const s = salt ?? randomBytes(16);
  const h = scryptSync(secret, s, 64);
  return {
    hash: h.toString("base64"),
    salt: s.toString("base64"),
  };
}

/**
 * Generate a new gateway API key. The returned `key` is the only time the
 * secret is exposed; callers must store the metadata (prefix/hash/salt) and
 * discard the key afterwards.
 */
export function generateApiKey(
  name: string,
  scopes: AuthScope[],
): { key: string; entry: ApiKeyEntry } {
  const secret = randomBytes(32).toString("base64url");
  const prefix = `${API_KEY_PREFIX}_${name}`;
  const { hash, salt } = hashApiKeySecret(secret);
  const key = `${prefix}_${secret}`;
  const entry: ApiKeyEntry = {
    name,
    prefix,
    hash,
    salt,
    scopes,
    createdAt: new Date().toISOString(),
  };
  return { key, entry };
}

/**
 * Parse the API_KEY_STORE env value. An empty string or "[]" yields an empty
 * store, which is fine for local development where only operator JWTs are used.
 */
export function parseApiKeyStore(raw: string): ApiKeyEntry[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error("API_KEY_STORE must be a JSON array");
  return parsed as ApiKeyEntry[];
}

export function resolveAuthProvider(config: AuthProviderConfig): AuthProvider {
  const secretBytes = new TextEncoder().encode(config.jwtSecret);
  const issuer = config.issuer ?? "modeltrace-api";
  const audience = config.audience ?? "modeltrace-api";

  function isExpired(entry: ApiKeyEntry): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > new Date(entry.expiresAt).getTime();
  }

  function parseApiKeyHeader(header: string): { prefix: string; secret: string } | null {
    const [type, credential] = header.split(" ", 2);
    if (type !== TOKEN_TYPE_API_KEY || !credential) return null;

    // Format: mt_<name>_<secret>. The secret is everything after the second
    // underscore so it may contain underscores without breaking parsing.
    const firstUnderscore = credential.indexOf("_");
    if (firstUnderscore === -1 || credential.slice(0, firstUnderscore) !== API_KEY_PREFIX) return null;
    const rest = credential.slice(firstUnderscore + 1);
    const secondUnderscore = rest.indexOf("_");
    if (secondUnderscore === -1) return null;
    const name = rest.slice(0, secondUnderscore);
    const secret = rest.slice(secondUnderscore + 1);
    if (!name || !secret) return null;
    return { prefix: `${API_KEY_PREFIX}_${name}`, secret };
  }

  return {
    async authenticate(req): Promise<AuthenticatedIdentity | null> {
      const authHeader = req.headers.authorization;
      if (typeof authHeader !== "string" || authHeader.length === 0) return null;

      const [type] = authHeader.split(" ", 1);

      if (type === TOKEN_TYPE_API_KEY) {
        const parsed = parseApiKeyHeader(authHeader);
        if (!parsed) return null;

        const candidates = config.apiKeyStore.filter(
          (k) => k.prefix === parsed.prefix && !isExpired(k),
        );
        if (candidates.length === 0) return null;

        for (const entry of candidates) {
          const salt = Buffer.from(entry.salt, "base64");
          const expected = Buffer.from(entry.hash, "base64");
          const actual = scryptSync(parsed.secret, salt, expected.length);
          if (timingSafeEqual(actual, expected)) {
            return { type: "gateway", subject: entry.name, scopes: entry.scopes };
          }
        }
        return null;
      }

      if (type === TOKEN_TYPE_BEARER) {
        const token = authHeader.slice(TOKEN_TYPE_BEARER.length + 1);
        try {
          const { payload } = await jwtVerify(token, secretBytes, { issuer, audience });
          const sub = payload.sub;
          const scopes = payload.scope;
          if (typeof sub !== "string" || !Array.isArray(scopes)) return null;
          return { type: "operator", subject: sub, scopes: scopes as AuthScope[] };
        } catch {
          return null;
        }
      }

      return null;
    },

    async issueOperatorToken(subject, scopes) {
      return new SignJWT({ scope: scopes })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(subject)
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime("8h")
        .sign(secretBytes);
    },

    verifyScope(req, scope) {
      return req.identity?.scopes.includes(scope) ?? false;
    },
  };
}
