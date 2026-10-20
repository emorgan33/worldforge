export type WorldCreationPayload = { title: string; description: string; system: string; requestId: string };
export type ConfirmedWorld<T> = { world: T; payload: WorldCreationPayload };
export type WorldCreationRecovery<T> = { pending?: WorldCreationPayload; confirmed?: ConfirmedWorld<T> };
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memory = new Map<string, WorldCreationRecovery<unknown>>();
export const worldCreationRecoveryKey = (actorId: string) => `worldforge:world-creation:${actorId}`;

function browserStorage(): StorageLike | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

export function readWorldCreationRecovery<T>(actorId: string, storage = browserStorage()): { recovery: WorldCreationRecovery<T>; storageAvailable: boolean } {
  const key = worldCreationRecoveryKey(actorId);
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const recovery = JSON.parse(raw) as WorldCreationRecovery<T>;
        memory.set(key, recovery);
        return { recovery, storageAvailable: true };
      }
      return { recovery: (memory.get(key) as WorldCreationRecovery<T> | undefined) ?? {}, storageAvailable: true };
    } catch { return { recovery: (memory.get(key) as WorldCreationRecovery<T> | undefined) ?? {}, storageAvailable: false }; }
  }
  return { recovery: (memory.get(key) as WorldCreationRecovery<T> | undefined) ?? {}, storageAvailable: false };
}

export function writeWorldCreationRecovery<T>(actorId: string, recovery: WorldCreationRecovery<T>, storage = browserStorage()): boolean {
  const key = worldCreationRecoveryKey(actorId);
  memory.set(key, recovery);
  if (!storage) return false;
  try { storage.setItem(key, JSON.stringify(recovery)); return true; } catch { return false; }
}

export function clearWorldCreationRecovery(actorId: string, storage = browserStorage()): boolean {
  const key = worldCreationRecoveryKey(actorId);
  memory.delete(key);
  if (!storage) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}

export function sameWorldCreationPayload(a: WorldCreationPayload, b: Omit<WorldCreationPayload, "requestId">): boolean {
  return a.title === b.title && a.description === b.description && a.system === b.system;
}

export function resetWorldCreationRecoveryForTests() { memory.clear(); }
