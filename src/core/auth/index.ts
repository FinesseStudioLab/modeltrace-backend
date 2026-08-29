import type { FastifyRequest, FastifyReply } from "fastify";

export interface CallerContext {
  payerId: string;
  role: "payer" | "admin";
}

declare module "fastify" {
  interface FastifyRequest {
    caller: CallerContext;
  }
}

/**
 * A simple middleware to simulate authentication and extract the caller's identity.
 * In a real scenario, this would verify a JWT or an API key.
 * For now, we mock it by reading a custom header or defaulting to a test identity.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const payerId = req.headers["x-payer-id"];
  
  if (!payerId || Array.isArray(payerId)) {
    return reply.status(401).send({ error: "Unauthorized: Missing x-payer-id header for simulation" });
  }

  req.caller = {
    payerId,
    role: payerId === "admin" ? "admin" : "payer",
  };
}
