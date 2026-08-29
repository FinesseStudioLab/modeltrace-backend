import type { FastifyRequest } from "fastify";

export type AuthScope =
  | "attest:write"
  | "usage:write"
  | "export:read"
  | "admin"
  | "dispute:read"
  | "dispute:write"
  | "meta:read";

export interface AuthenticatedIdentity {
  /** Gateway API keys are machine clients; operator JWTs are dashboard users. */
  type: "gateway" | "operator";
  /** Stable identifier for the caller — gateway name or operator subject. */
  subject: string;
  /** Scopes granted to this identity. */
  scopes: AuthScope[];
}

export interface ApiKeyEntry {
  /** Human-readable name, e.g. "inference-gateway-prod". */
  name: string;
  /** Detectable prefix for leak scanning, e.g. "mt_gateway-prod". */
  prefix: string;
  /** base64 scrypt hash of the key secret. */
  hash: string;
  /** base64 random salt used for the hash. */
  salt: string;
  scopes: AuthScope[];
  /** ISO timestamp when the key was created. */
  createdAt: string;
  /** Optional ISO expiry; the key is rejected after this point. */
  expiresAt?: string;
}

export interface AuthProvider {
  authenticate(req: FastifyRequest): Promise<AuthenticatedIdentity | null>;
  issueOperatorToken(subject: string, scopes: AuthScope[]): Promise<string>;
  verifyScope(req: FastifyRequest, scope: AuthScope): boolean;
}

export interface AuthProviderConfig {
  jwtSecret: string;
  apiKeyStore: ApiKeyEntry[];
  issuer?: string;
  audience?: string;
}
