/**
 * Gold risk ids must be members of the public taxonomy. Matching stays exact;
 * this check does not invent aliases.
 */
export function goldRiskIdsOutsideTaxonomy(
  taxonomyIds: readonly string[],
  goldIds: readonly string[],
): string[] {
  const allowed = new Set(taxonomyIds);
  return [...new Set(goldIds.filter((id) => !allowed.has(id)))].sort();
}
