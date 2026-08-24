/**
 * Contract state reads, classified by how often the underlying value can
 * change on-chain.
 *
 * The classification is the whole point of the caching policy in ADR 0002:
 * "contract metadata is effectively immutable, quota balances are not" is not
 * a colourful way of saying "give both a TTL" — the two types sit at opposite
 * ends of the staleness spectrum, and a billing product has to be honest about
 * which end a number came from. The TTL table below is the written policy; see
 * `docs/adr/0002-contract-read-caching.md` for the full reasoning.
 */

/** The kinds of contract state this service reads via RPC. */
export const ContractReadType = {
  /**
   * Metadata: name, version, owner, entry points. Set once at deployment and
   * only ever changed by a deliberate contract migration, which is a release
   * event this service participates in — so a long TTL costs nothing.
   */
  Metadata: "metadata",

  /**
   * Quota balances: the number a billing dispute is about. Changes on every
   * metered batch, so the TTL is short and every serving decision carries an
   * as-of timestamp.
   */
  QuotaBalance: "quota-balance",
} as const;

export type ContractReadType =
  (typeof ContractReadType)[keyof typeof ContractReadType];

/**
 * Per-type TTLs. The reasoning for each number lives next to the value rather
 * than in the ADR, so that changing one is a code review of the trade-off and
 * not a treasure hunt.
 *
 * - `metadata` — 24h. Immutable in practice: the only way it changes is a
 *   contract migration, and a migration is already a deploy-time event that
 *   can carry an explicit invalidation. Waiting out the TTL after a migration
 *   is a bounded, visible staleness; the alternative (short TTL on every
 *   metadata read) taxes the hot path for a case that happens monthly at most.
 *   Indexer-driven invalidation covers the migration case without the tax.
 *
 * - `quota-balance` — 30s. Bounded staleness on the hot path. A payer's quota
 *   changes on every metered batch, so the value is only ever an estimate —
 *   the authoritative number lives on-chain and the contract enforces it. The
 *   TTL exists to keep a dashboard from exhausting the RPC budget, not to make
 *   the number authoritative; 30s is short enough that a dispute over a
 *   mid-session number is settled by the on-chain record, and long enough that
 *   a hundred-payer dashboard is ~3 RPC calls/s at steady state instead of a
 *   request per poll.
 */
export const CONTRACT_READ_TTL_MS: Readonly<Record<ContractReadType, number>> = {
  [ContractReadType.Metadata]: 24 * 60 * 60 * 1000,
  [ContractReadType.QuotaBalance]: 30 * 1000,
};
