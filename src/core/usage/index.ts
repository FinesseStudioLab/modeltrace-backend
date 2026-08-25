import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { GetUsageQuery } from "../../schemas/usage.js";
import type { CallerContext } from "../auth/index.js";

export async function getUsage(query: GetUsageQuery, caller: CallerContext) {
  const { cursor, limit, payer, model, policy, startDate, endDate, status, group_by } = query;

  // Row-level authorization
  const tenantFilter = caller.role === "admin" ? {} : { payer: caller.payerId };

  if (payer && caller.role !== "admin" && payer !== caller.payerId) {
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

  if (group_by) {
    // If grouped, we use groupBy and do not support stable cursor pagination easily 
    // without complex subqueries. We'll implement offset pagination or just return all grouped for now,
    // or limit by results. Cursor pagination on grouped results is notoriously difficult.
    // For simplicity, we just return the grouped results limited.
    const groupByFields: Prisma.UsageScalarFieldEnum[] = [];
    if (group_by === "model") groupByFields.push("model");
    else if (group_by === "payer") groupByFields.push("payer");
    
    // For "day", Prisma doesn't natively support Date truncation in groupBy without raw queries.
    if (group_by === "day") {
       // Mock raw query for day grouping
       // This would ideally be a Prisma $queryRaw, but to keep it DB-agnostic (SQLite/Postgres) 
       // we fetch and group in memory if needed, or use $queryRaw.
       // Here we use in-memory for this scaffold as date functions vary heavily.
       const results = await prisma.usage.findMany({ where: filters });
       const grouped = new Map<string, any>();
       for (const r of results) {
         const day = r.createdAt.toISOString().split("T")[0];
         if (!grouped.has(day)) {
           grouped.set(day, { day, _sum: { units: 0 } });
         }
         grouped.get(day)._sum.units += r.units;
       }
       return {
         data: Array.from(grouped.values()).slice(0, limit),
         nextCursor: null, // Cursor not supported on grouped by day
       };
    }

    if (group_by === "model") {
      const grouped = await prisma.usage.groupBy({
        by: ["model"],
        where: filters,
        _sum: { units: true },
        take: limit,
        orderBy: { model: 'asc' }
      });
      return { data: grouped, nextCursor: null };
    } else if (group_by === "payer") {
      const grouped = await prisma.usage.groupBy({
        by: ["payer"],
        where: filters,
        _sum: { units: true },
        take: limit,
        orderBy: { payer: 'asc' }
      });
      return { data: grouped, nextCursor: null };
    }

  }

  // Standard non-grouped request
  const results = await prisma.usage.findMany({
    where: filters,
    take: limit + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ]
  });

  let nextCursor: string | null = null;
  if (results.length > limit) {
    const nextItem = results.pop();
    nextCursor = nextItem!.id;
  }

  return {
    data: results,
    nextCursor,
  };
}
