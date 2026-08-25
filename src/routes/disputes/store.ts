import { createHash, randomUUID } from "node:crypto";
import type { Dispute, DisputeRole, EvidenceItem, Notification } from "./types.js";

export function hashEvidence(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface RaiseDisputeInput {
  settlementId: string;
  reason: string;
  buyerId: string;
  sellerId: string;
  raisedBy: DisputeRole;
  evidence?: string;
  windowMs: number;
  now?: number;
}

/**
 * In-memory store for the dispute lifecycle, with role-scoped queries and a
 * notification log. Evidence content is kept alongside its hash here; a
 * production deployment would put `content` in access-controlled off-chain
 * storage and commit only `contentHash` on-chain (same principle as
 * inference payloads) — this store already keeps that split so wiring in
 * real off-chain storage and a real on-chain commit call is a swap of one
 * function, not a data-model change.
 */
export class DisputeStore {
  private disputes = new Map<string, Dispute>();
  notifications: Notification[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  raise(input: RaiseDisputeInput): Dispute {
    const createdAt = input.now ?? this.now();
    const evidence: EvidenceItem[] = input.evidence
      ? [
          {
            id: randomUUID(),
            submittedBy: input.raisedBy,
            content: input.evidence,
            contentHash: hashEvidence(input.evidence),
            createdAt,
          },
        ]
      : [];

    const dispute: Dispute = {
      id: randomUUID(),
      settlementId: input.settlementId,
      reason: input.reason,
      status: "open",
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      evidence,
      windowClosesAt: createdAt + input.windowMs,
      createdAt,
      updatedAt: createdAt,
    };
    this.disputes.set(dispute.id, dispute);
    this.notify(dispute.id, "raised");
    return dispute;
  }

  get(id: string): Dispute | undefined {
    return this.disputes.get(id);
  }

  /** Role-scoped: buyers/sellers only see disputes they're a party to. */
  listForRole(role: DisputeRole, userId: string): Dispute[] {
    const all = [...this.disputes.values()];
    if (role === "adjudicator") return all;
    return all.filter((d) => d.buyerId === userId || d.sellerId === userId);
  }

  canAccess(dispute: Dispute, role: DisputeRole, userId: string): boolean {
    if (role === "adjudicator") return true;
    return dispute.buyerId === userId || dispute.sellerId === userId;
  }

  isWindowOpen(dispute: Dispute): boolean {
    return this.now() < dispute.windowClosesAt;
  }

  addEvidence(id: string, submittedBy: DisputeRole, content: string): Dispute | undefined {
    const dispute = this.disputes.get(id);
    if (!dispute) return undefined;
    dispute.evidence.push({
      id: randomUUID(),
      submittedBy,
      content,
      contentHash: hashEvidence(content),
      createdAt: this.now(),
    });
    dispute.status = "evidence";
    dispute.updatedAt = this.now();
    this.notify(id, "evidence-added");
    return dispute;
  }

  resolve(
    id: string,
    outcome: "buyer" | "seller" | "split",
    notes: string,
  ): Dispute | undefined {
    const dispute = this.disputes.get(id);
    if (!dispute) return undefined;
    dispute.status = "resolved";
    dispute.outcome = { outcome, notes, resolvedAt: this.now() };
    dispute.updatedAt = this.now();
    this.notify(id, "resolved");
    return dispute;
  }

  private notify(disputeId: string, event: Notification["event"]) {
    this.notifications.push({ disputeId, event, at: this.now() });
  }
}
