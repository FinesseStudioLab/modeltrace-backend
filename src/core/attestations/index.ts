import { prisma } from "../db.js";
import type { GetAttestationsQuery } from "../../schemas/attestations.js";
import type { CallerContext } from "../auth/index.js";

export async function getAttestations(query: GetAttestationsQuery, caller: CallerContext) {
  const { cursor, limit, payer, model, policy, startDate, endDate, status } = query;

  // Row-level authorization: ensure the caller can only fetch their own data unless admin
  const tenantFilter = caller.role === "admin" ? {} : { payer: caller.payerId };

  // If a payer filter is provided, verify it does not exceed tenant bounds
  if (payer && caller.role !== "admin" && payer !== caller.payerId) {
    // Return empty if they try to fetch another tenant's data
    return { data: [], nextCursor: null };
  }

  const effectivePayerFilter = payer || tenantFilter.payer;

  const filters: any = {};
  if (effectivePayerFilter) filters.payer = effectivePayerFilter;
  if (model) filters.model = model;
  if (policy) filters.policy = policy;
  if (status) filters.status = status;

  if (startDate || endDate) {
    filters.createdAt = {};
    if (startDate) filters.createdAt.gte = new Date(startDate);
    if (endDate) filters.createdAt.lte = new Date(endDate);
  }

  const results = await prisma.attestation.findMany({
    where: filters,
    take: limit + 1, // Fetch one extra to determine if there's a next page
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip the cursor itself
    }),
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ]
  });

  let nextCursor: string | null = null;
  if (results.length > limit) {
    const nextItem = results.pop(); // Remove the extra item
    nextCursor = nextItem!.id;
  }

  return {
    data: results,
    nextCursor,
  };
}

export async function getAttestationById(id: string, caller: CallerContext) {
  const record = await prisma.attestation.findUnique({
    where: { id },
  });

  if (!record) return null;

  // Row-level authorization
  if (caller.role !== "admin" && record.payer !== caller.payerId) {
    return null; // Return null instead of 403 to prevent data existence leakage
  }

  return record;
}
