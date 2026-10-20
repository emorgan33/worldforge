// Pure world-selection resolution for the author workspace.
//
// Priority: explicit URL `?world=<id>` (validated against the authorized
// owned-world list, so foreign/missing IDs never disclose data) → last-used
// world for this browser (validated the same way) → oldest owned world.
// Last-used browser storage from another account can therefore never select
// or expose a foreign world, and unavailable storage is harmless.

export type SelectableWorld = { id: string };

export const WORLD_HISTORY_INDEX_KEY = "__worldforgeIndex";

export function getWorldHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[WORLD_HISTORY_INDEX_KEY];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Number of history entries to traverse in the opposite direction after a
 * canceled pop. A pop from 4 to 2 is compensated by +2. */
export function getHistoryCompensation(previousIndex: number, destinationIndex: number): number {
  return previousIndex - destinationIndex;
}

export function isWorldDatasetSnapshot(value: unknown[]): value is unknown[][] {
  return value.every(Array.isArray);
}

export function resolveWorldSelection(
  worlds: SelectableWorld[],
  candidates: { urlWorldId?: string | null; storedWorldId?: string | null },
): { selectedId: string | null; usedStored: boolean; unknownUrlId: boolean } {
  const ids = new Set(worlds.map(world => world.id));
  const urlId = candidates.urlWorldId?.trim() ? candidates.urlWorldId.trim() : null;
  // An explicit URL ID outside the authorized list must render an unavailable
  // state — never disclose data or silently default to another world.
  if (urlId && !ids.has(urlId)) return { selectedId: null, usedStored: false, unknownUrlId: true };
  if (urlId) return { selectedId: urlId, usedStored: false, unknownUrlId: false };
  const storedId = candidates.storedWorldId?.trim() ? candidates.storedWorldId!.trim() : null;
  if (storedId && ids.has(storedId)) return { selectedId: storedId, usedStored: true, unknownUrlId: false };
  return { selectedId: worlds[0]?.id ?? null, usedStored: false, unknownUrlId: false };
}

export function worldSelectionStorageKey(actorId: string) {
  return `worldforge:last-world:${actorId}`;
}

export function readStoredWorldId(actorId: string, storage?: Pick<Storage, "getItem"> | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(worldSelectionStorageKey(actorId));
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredWorldId(actorId: string, worldId: string, storage?: Pick<Storage, "setItem"> | null): void {
  if (!storage) return;
  try {
    storage.setItem(worldSelectionStorageKey(actorId), worldId);
  } catch {
    // Blocked storage is harmless: selection still works for this page load.
  }
}
