import type { FastifyPluginAsync } from "fastify";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "modeltrace-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};

// patch: 2026-06-02T18:00:00

// patch: 2026-06-03T09:00:00

// patch: 2026-06-04T00:00:00

// patch: 2026-06-05T06:00:00

// patch: 2026-06-05T21:00:00

// patch: 2026-06-12T03:00:00

// patch: 2026-06-20T06:00:00

// patch: 2026-06-20T21:00:00

// patch: 2026-06-21T12:00:00

// patch: 2026-06-25T21:00:00

// patch: 2026-06-28T09:00:00
