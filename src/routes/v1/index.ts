import type { FastifyPluginAsync } from "fastify";
import { config } from "../../config/env.js";
import { getMetaInfo } from "../../meta/version.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => getMetaInfo(config));

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};
