import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { DisputeStore } from "./store.js";
import {
  addEvidenceSchema,
  disputeRoleSchema,
  raiseDisputeSchema,
  resolveDisputeSchema,
  type DisputeRole,
} from "./types.js";

export interface DisputeRoutesOptions {
  /** How long the evidence window stays open after a dispute is raised. */
  windowMs?: number;
  store?: DisputeStore;
}

/**
 * Everything the dispute lifecycle needs: raise, list (role-scoped),
 * attach evidence, and resolve. Auth is a placeholder — the repo has no
 * session/identity layer yet, so role and user identity are read from
 * headers the same way a real gateway would inject them post-auth. This
 * keeps the role-scoping logic itself (the part the acceptance criteria
 * care about) real and testable without inventing an auth system.
 */
export const disputeRoutes: FastifyPluginAsync<DisputeRoutesOptions> = async (
  app,
  opts,
) => {
  const store = opts.store ?? new DisputeStore();
  const windowMs = opts.windowMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days

  function actor(req: FastifyRequest): { role: DisputeRole; userId: string } | null {
    const roleHeader = req.headers["x-role"];
    const userId = req.headers["x-user-id"];
    const parsed = disputeRoleSchema.safeParse(
      Array.isArray(roleHeader) ? roleHeader[0] : roleHeader,
    );
    if (!parsed.success || typeof userId !== "string" || userId.length === 0) return null;
    return { role: parsed.data, userId };
  }

  app.post("/disputes", async (req, reply) => {
    const who = actor(req);
    if (!who) return reply.code(401).send({ error: "missing or invalid x-role/x-user-id" });

    const body = raiseDisputeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const dispute = store.raise({
      ...body.data,
      raisedBy: who.role,
      windowMs,
    });
    return reply.code(201).send(dispute);
  });

  app.get("/disputes", async (req, reply) => {
    const who = actor(req);
    if (!who) return reply.code(401).send({ error: "missing or invalid x-role/x-user-id" });

    return reply.send(store.listForRole(who.role, who.userId));
  });

  app.post<{ Params: { id: string } }>("/disputes/:id/evidence", async (req, reply) => {
    const who = actor(req);
    if (!who) return reply.code(401).send({ error: "missing or invalid x-role/x-user-id" });

    const dispute = store.get(req.params.id);
    if (!dispute) return reply.code(404).send({ error: "dispute not found" });
    if (!store.canAccess(dispute, who.role, who.userId)) {
      return reply.code(403).send({ error: "not a party to this dispute" });
    }
    if (!store.isWindowOpen(dispute)) {
      return reply.code(409).send({ error: "evidence window has closed" });
    }

    const body = addEvidenceSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const updated = store.addEvidence(req.params.id, who.role, body.data.content);
    return reply.send(updated);
  });

  app.post<{ Params: { id: string } }>("/disputes/:id/resolve", async (req, reply) => {
    const who = actor(req);
    if (!who) return reply.code(401).send({ error: "missing or invalid x-role/x-user-id" });
    if (who.role !== "adjudicator") {
      return reply.code(403).send({ error: "only an adjudicator may resolve a dispute" });
    }

    const dispute = store.get(req.params.id);
    if (!dispute) return reply.code(404).send({ error: "dispute not found" });

    const body = resolveDisputeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const updated = store.resolve(req.params.id, body.data.outcome, body.data.notes);
    return reply.send(updated);
  });
};
