import { z } from "zod";
import { paginationQuerySchema } from "./common.js";

export const getUsageQuerySchema = paginationQuerySchema.extend({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  payer: z.string().optional(),
  model: z.string().optional(),
  policy: z.string().optional(),
  status: z.enum(["pending", "verified", "failed"]).optional(),
  group_by: z.enum(["model", "payer", "day"]).optional(),
}).refine((data) => {
  if (data.startDate && data.endDate) {
    return new Date(data.startDate) <= new Date(data.endDate);
  }
  return true;
}, { message: "startDate must be before endDate" });

export type GetUsageQuery = z.infer<typeof getUsageQuerySchema>;
