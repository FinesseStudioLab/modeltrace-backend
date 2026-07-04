import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }));
};

// patch: 2026-06-02T03:00:00

// patch: 2026-06-27T18:00:00

// patch: 2026-07-04T15:00:00
