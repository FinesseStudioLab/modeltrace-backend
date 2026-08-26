import { z } from "zod";

export const disputeRoleSchema = z.enum(["buyer", "seller", "adjudicator"]);
export type DisputeRole = z.infer<typeof disputeRoleSchema>;

export const disputeStatusSchema = z.enum(["open", "evidence", "resolved"]);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

export const raiseDisputeSchema = z.object({
  settlementId: z.string().min(1),
  reason: z.string().min(1),
  // The settlement service isn't wired up yet, so the two parties are
  // supplied by the caller rather than looked up by settlementId.
  buyerId: z.string().min(1),
  sellerId: z.string().min(1),
  evidence: z.string().min(1).optional(),
});

export const addEvidenceSchema = z.object({
  content: z.string().min(1),
});

export const resolveDisputeSchema = z.object({
  outcome: z.enum(["buyer", "seller", "split"]),
  notes: z.string().min(1),
});

export interface EvidenceItem {
  id: string;
  submittedBy: DisputeRole;
  /** sha256 commitment of `content` — this is what would go on-chain. */
  contentHash: string;
  content: string;
  createdAt: number;
}

export interface Dispute {
  id: string;
  settlementId: string;
  reason: string;
  status: DisputeStatus;
  buyerId: string;
  sellerId: string;
  evidence: EvidenceItem[];
  outcome?: { outcome: "buyer" | "seller" | "split"; notes: string; resolvedAt: number };
  windowClosesAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Notification {
  disputeId: string;
  event: "raised" | "evidence-added" | "resolved" | "window-expired";
  at: number;
}
