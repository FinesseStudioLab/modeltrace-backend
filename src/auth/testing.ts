import type { FastifyRequest } from "fastify";
import type { AuthProvider, AuthScope, AuthenticatedIdentity } from "./types.js";

export interface TestAuthProviderOptions {
  /** If provided, only this exact header value authenticates. */
  header?: string;
  /** Default identity returned for authenticated requests. */
  identity?: AuthenticatedIdentity;
}

/**
 * A no-crypto auth provider for route unit tests. Authentication succeeds when
 * the request carries `x-test-auth: <subject>,<scope1>,<scope2>`.
 */
export function createTestAuthProvider(
  defaults: TestAuthProviderOptions = {},
): AuthProvider {
  const headerName = defaults.header ?? "x-test-auth";

  return {
    async authenticate(req: FastifyRequest): Promise<AuthenticatedIdentity | null> {
      const raw = req.headers[headerName];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (typeof value !== "string" || value.length === 0) return null;

      const [subject, ...scopes] = value.split(",");
      if (!subject) return null;

      return {
        type: "operator",
        subject,
        scopes: (scopes.length ? scopes : ["meta:read"]) as AuthScope[],
      };
    },

    async issueOperatorToken(): Promise<string> {
      return "test-token";
    },

    verifyScope(req, scope) {
      return req.identity?.scopes.includes(scope) ?? false;
    },
  };
}
