/**
 * Contract read caching — see `docs/adr/0002-contract-read-caching.md`.
 *
 * The intended shape of usage, once RPC and indexer clients exist:
 *
 *   const metadataCache = createContractReadCache<ContractMetadata>(
 *     ContractReadType.Metadata,
 *     { onEvent: (event, detail) => app.log.info({ event, ...detail }, event) },
 *   );
 *
 *   // RPC read path:
 *   const { value, asOf, stale } = await metadataCache.read(
 *     `metadata:${contractId}`,
 *     () => rpc.readContractMetadata(contractId),
 *   );
 *
 *   // Indexer event path (instead of waiting out the TTL):
 *   metadataCache.invalidate(`metadata:${contractId}`);
 */

import {
  ContractReadCache,
  type ContractReadCacheOptions,
} from "./cache.js";
import { CONTRACT_READ_TTL_MS, ContractReadType } from "./types.js";

export {
  ContractReadCache,
  ContractReadEvent,
  type CachedRead,
  type ContractReadCacheOptions,
} from "./cache.js";
export { CONTRACT_READ_TTL_MS, ContractReadType } from "./types.js";

/**
 * Build a cache for one read type, wired to the TTL documented for that type
 * in `types.ts`. The type → TTL binding lives here so that creating a cache is
 * a one-line statement of policy, and so a new read type must pick a TTL in
 * the same breath as it is added.
 */
export function createContractReadCache<T>(
  type: ContractReadType,
  options: Omit<ContractReadCacheOptions, "ttlMs"> = {},
): ContractReadCache<T> {
  return new ContractReadCache<T>({
    ...options,
    ttlMs: CONTRACT_READ_TTL_MS[type],
  });
}
