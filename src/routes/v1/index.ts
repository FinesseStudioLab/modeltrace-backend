import type { FastifyPluginAsync } from "fastify";
import { disputeRoutes } from "../disputes/index.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "modeltrace-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  await app.register(disputeRoutes);

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};
