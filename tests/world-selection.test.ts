import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readStoredWorldId,
  resolveWorldSelection,
  getHistoryCompensation,
  getWorldHistoryIndex,
  isWorldDatasetSnapshot,
  WORLD_HISTORY_INDEX_KEY,
  worldSelectionStorageKey,
  writeStoredWorldId,
} from "../src/lib/world-selection";

test("explicit URL selection wins over stored and default worlds", () => {
  const worlds = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(resolveWorldSelection(worlds, { urlWorldId: "b", storedWorldId: "a" }), { selectedId: "b", usedStored: false, unknownUrlId: false });
});

test("unknown URL IDs render an unavailable state instead of falling back", () => {
  const worlds = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(resolveWorldSelection(worlds, { urlWorldId: "foreign", storedWorldId: "b" }), { selectedId: null, usedStored: false, unknownUrlId: true });
});

test("without an explicit URL, selection falls back to a validated stored world, then the oldest world", () => {
  const worlds = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(resolveWorldSelection(worlds, { storedWorldId: "b" }), { selectedId: "b", usedStored: true, unknownUrlId: false });
  assert.deepEqual(resolveWorldSelection(worlds, { storedWorldId: "foreign" }), { selectedId: "a", usedStored: false, unknownUrlId: false });
});

test("empty world lists select nothing, and stored foreign IDs are ignored", () => {
  assert.deepEqual(resolveWorldSelection([], { urlWorldId: "a", storedWorldId: "a" }), { selectedId: null, usedStored: false, unknownUrlId: true });
  assert.deepEqual(resolveWorldSelection([{ id: "a" }], { storedWorldId: "other-account-world" }), { selectedId: "a", usedStored: false, unknownUrlId: false });
});

test("last-used storage is actor-scoped and blocked storage is harmless", () => {
  assert.notEqual(worldSelectionStorageKey("actor-a"), worldSelectionStorageKey("actor-b"));
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  writeStoredWorldId("actor-a", "world-1", storage);
  assert.equal(readStoredWorldId("actor-a", storage), "world-1");
  assert.equal(readStoredWorldId("actor-b", storage), null);
  const denied = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  writeStoredWorldId("actor-a", "world-2", denied);
  assert.equal(readStoredWorldId("actor-a", null), null);
  assert.equal(readStoredWorldId("actor-a", denied), null);
});

test("history markers preserve valid traversal indexes and compensate canceled traversal", () => {
  assert.equal(getWorldHistoryIndex({ __nextRouter: true, [WORLD_HISTORY_INDEX_KEY]: 5 }), 5);
  assert.equal(getWorldHistoryIndex({ [WORLD_HISTORY_INDEX_KEY]: 2.5 }), null);
  assert.equal(getWorldHistoryIndex(null), null);
  assert.equal(getHistoryCompensation(4, 2), 2);
  assert.equal(getHistoryCompensation(1, 3), -2);
});

test("world snapshots reject non-array dataset payloads instead of treating them as empty", () => {
  assert.equal(isWorldDatasetSnapshot([[], [], []]), true);
  assert.equal(isWorldDatasetSnapshot([[], { error: "unauthorized" }]), false);
});
