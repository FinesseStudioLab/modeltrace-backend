import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthProvider } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    identity?: import("./types.js").AuthenticatedIdentity;
  }
}

/**
 * Register the global auth hook directly on the supplied Fastify instance.
 * This is intentionally not a plugin so the hook applies to sibling routes
 * registered on the same instance.
 */
export function registerAuthHooks(app: FastifyInstance, auth: AuthProvider) {
  app.addHook("onRequest", async (req, reply) => {
    // Routes opt out of auth by setting `config: { public: true }`.
    const routeConfig = req.routeOptions.config as { public?: boolean };
    if (routeConfig.public) return;

    const identity = await auth.authenticate(req);
    if (!identity) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    req.identity = identity;
  });
}
