import type { FastifyPluginAsync } from "fastify";
import { getUsage } from "../../core/usage/index.js";
import { getUsageQuerySchema } from "../../schemas/usage.js";
import { requireAuth } from "../../core/auth/index.js";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req, reply) => {
    const parsed = getUsageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters", details: parsed.error.issues });
    }

    const result = await getUsage(parsed.data, req.caller);
    return reply.send(result);
  });
};
