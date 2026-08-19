export type SearchProviderIdentity = {
  id: string;
};

/**
 * Return a new provider list in the exact runtime role order:
 * index 0 is primary and index 1 is fallback.
 */
export function orderSearchProvidersByRole<T extends SearchProviderIdentity>(
  providers: readonly T[],
  primaryProviderId: string,
): T[] {
  const rows = [...providers];
  if (rows.length < 2) return rows;
  const primaryIndex = rows.findIndex((provider) => provider.id === primaryProviderId);
  if (primaryIndex <= 0) return rows;
  const [primary] = rows.splice(primaryIndex, 1);
  return primary ? [primary, ...rows] : rows;
}
