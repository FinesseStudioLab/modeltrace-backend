import type { FastifyPluginAsync } from "fastify";
import { attestationsRoutes } from "./attestations.js";
import { usageRoutes } from "./usage.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "modeltrace-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  // Register the new API routes
  app.register(attestationsRoutes, { prefix: "/attestations" });
  app.register(usageRoutes, { prefix: "/usage" });
};
