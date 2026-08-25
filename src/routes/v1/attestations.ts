import type { FastifyPluginAsync } from "fastify";
import { getAttestations, getAttestationById } from "../../core/attestations/index.js";
import { getAttestationsQuerySchema } from "../../schemas/attestations.js";
import { requireAuth } from "../../core/auth/index.js";

export const attestationsRoutes: FastifyPluginAsync = async (app) => {
  // Add authentication hook for all routes in this plugin
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req, reply) => {
    // Validate query
    const parsed = getAttestationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters", details: parsed.error.issues });
    }

    const result = await getAttestations(parsed.data, req.caller);
    return reply.send(result);
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const record = await getAttestationById(id, req.caller);
    
    if (!record) {
      return reply.status(404).send({ error: "Attestation not found" });
    }

    return reply.send(record);
  });
};
