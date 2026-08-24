import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/v1/index.js";
import {
  redactSecrets,
  resolveSigningKeyProvider,
  type SigningKeyProvider,
} from "./core/signing/index.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Custody-aware signer. Exposes signatures, never key material. */
    signing: SigningKeyProvider;
  }
}

async function buildServer() {
  const app = Fastify({
    logger: {
      // Redaction runs at the serializer boundary rather than at call sites: a
      // secret reaches the log by being nested in a request body or hanging off
      // a thrown error's context, not by someone logging it directly. ADR 0001
      // requires that key material never appear in logs or error output, and a
      // boundary is the only place that can be guaranteed.
      serializers: {
        err: (err: FastifyError) => {
          const safe = redactSecrets(err) as Record<string, unknown>;
          return {
            ...safe,
            type: err.name ?? "Error",
            message: String(safe.message ?? ""),
            stack: String(safe.stack ?? ""),
          };
        },
        req: (req: FastifyRequest) => ({
          method: req.method,
          url: req.url,
          host: req.hostname,
          remoteAddress: req.ip,
          // Headers and query carry bearer tokens and API keys routinely.
          headers: redactSecrets(req.headers),
          query: redactSecrets(req.query),
        }),
        // Typed structurally: Fastify hands the response serializer a reply-like
        // shape rather than a full FastifyReply.
        res: (res: { statusCode: number }) => ({
          statusCode: res.statusCode,
        }),
      },
    },
  });

  // Resolved at startup so a custody misconfiguration fails the boot rather
  // than the first signing request, which could be days later.
  const signing = resolveSigningKeyProvider(config.signing, (event, detail) =>
    app.log.warn({ event, ...detail }, event),
  );
  app.decorate("signing", signing);

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: config.apiPrefix });

  return app;
}

buildServer()
  .then((app) =>
    app.listen({ port: config.port, host: "0.0.0.0" }),
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
