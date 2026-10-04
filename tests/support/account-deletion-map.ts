/**
 * Reads docs/account-deletion-map.md. Shared by the format test (no database) and the foreign-key catalogue test (database).
 */
export type MapKey = { key: string; parent: string; onDelete: string; cls: string; note: string };
export type MapBucket = { bucket: string; path: string; cls: string; note: string };

/** The ON DELETE actions each class is allowed to sit on. */
export const ON_DELETE_FOR_CLASS: Record<string, string[]> = {
  delete: ["CASCADE"],
  anonymise: ["SET NULL"],
  detach: ["SET NULL"],
  block: ["NO ACTION", "RESTRICT"],
  auth: ["CASCADE", "SET NULL"],
  internal: ["CASCADE"],
  decide: ["CASCADE", "SET NULL", "NO ACTION", "RESTRICT"],
};

export function parseAccountDeletionMap(doc: string): { keys: MapKey[]; buckets: MapBucket[] } {
  const keys: MapKey[] = [];
  const buckets: MapBucket[] = [];
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const first = /^`([^`]+)`$/.exec(cells[0] ?? "");
    if (!first) continue;
    if (cells.length === 5 && /^[a-z_]+\.[a-z_*]+$/.test(first[1])) {
      keys.push({ key: first[1], parent: cells[1], onDelete: cells[2], cls: cells[3], note: cells[4] });
    } else if (cells.length === 4 && /^[a-z-]+$/.test(first[1])) {
      buckets.push({ bucket: first[1], path: cells[1], cls: cells[2], note: cells[3] });
    }
  }
  return { keys, buckets };
}
