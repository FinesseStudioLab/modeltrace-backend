import type { FastifyPluginAsync } from "fastify";
import { config } from "../../config/env.js";
import { getMetaInfo } from "../../meta/version.js";
import { disputeRoutes } from "../disputes/index.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  // Public service metadata — safe to expose without credentials.
  app.get("/meta", { config: { public: true } }, async () => getMetaInfo(config));

  await app.register(disputeRoutes);

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};
