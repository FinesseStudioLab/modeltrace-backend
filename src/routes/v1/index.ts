import type { FastifyPluginAsync } from "fastify";
import { attestationsRoutes } from "./attestations.js";
import { usageRoutes } from "./usage.js";
import { config } from "../../config/env.js";
import { getMetaInfo } from "../../meta/version.js";
import { disputeRoutes } from "../disputes/index.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => getMetaInfo(config));

  await app.register(disputeRoutes);

  // Register the new API routes
  app.register(attestationsRoutes, { prefix: "/attestations" });
  app.register(usageRoutes, { prefix: "/usage" });
};
