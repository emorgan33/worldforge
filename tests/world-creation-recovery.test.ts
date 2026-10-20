import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearWorldCreationRecovery,
  readWorldCreationRecovery,
  resetWorldCreationRecoveryForTests,
  sameWorldCreationPayload,
  worldCreationRecoveryKey,
  writeWorldCreationRecovery,
  type StorageLike,
  type WorldCreationPayload,
} from "../src/lib/world-creation-recovery";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const payload: WorldCreationPayload = {
  title: "The Ashen Coast",
  description: "A setting introduction.",
  system: "PF_2E",
  requestId: "3f23f354-c76b-447d-8430-7b8da3948950",
};

test("retry recovery preserves the exact normalized request ID and payload", () => {
  resetWorldCreationRecoveryForTests();
  const storage = new MemoryStorage();
  assert.equal(writeWorldCreationRecovery("actor-a", { pending: payload }, storage), true);
  const restored = readWorldCreationRecovery<unknown>("actor-a", storage);
  assert.deepEqual(restored.recovery.pending, payload);
  assert.equal(restored.storageAvailable, true);
  assert.equal(sameWorldCreationPayload(restored.recovery.pending!, { title: payload.title, description: payload.description, system: payload.system }), true);
});

test("recovery keys and records are isolated by actor", () => {
  resetWorldCreationRecoveryForTests();
  const storage = new MemoryStorage();
  writeWorldCreationRecovery("actor-a", { pending: payload }, storage);
  assert.equal(worldCreationRecoveryKey("actor-a"), "worldforge:world-creation:actor-a");
  assert.equal(readWorldCreationRecovery("actor-b", storage).recovery.pending, undefined);
  assert.notEqual(worldCreationRecoveryKey("actor-a"), worldCreationRecoveryKey("actor-b"));
});

test("denied storage retains pending or confirmed recovery for a dialog reopened in this page", () => {
  resetWorldCreationRecoveryForTests();
  const denied: StorageLike = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.equal(writeWorldCreationRecovery("actor-a", { pending: payload }, denied), false);
  const reopened = readWorldCreationRecovery("actor-a", denied);
  assert.equal(reopened.storageAvailable, false);
  assert.deepEqual(reopened.recovery.pending, payload);

  const world = { id: "world-1", title: "The Ashen Coast" };
  assert.equal(writeWorldCreationRecovery("actor-a", { confirmed: { world, payload } }, denied), false);
  assert.deepEqual(readWorldCreationRecovery("actor-a", denied).recovery.confirmed, { world, payload });
  clearWorldCreationRecovery("actor-a", denied);
  assert.equal(readWorldCreationRecovery("actor-a", denied).recovery.confirmed, undefined);
});

test("changed normalized details are identified as requiring reconciliation", () => {
  assert.equal(sameWorldCreationPayload(payload, { title: payload.title, description: payload.description, system: payload.system }), true);
  assert.equal(sameWorldCreationPayload(payload, { title: "A different world", description: payload.description, system: payload.system }), false);
  assert.equal(sameWorldCreationPayload(payload, { title: payload.title, description: payload.description, system: "DND_5E" }), false);
});

test("confirmed world recovery retains the world and original request for an open retry", () => {
  resetWorldCreationRecoveryForTests();
  const storage = new MemoryStorage();
  const confirmed = { world: { id: "world-1", title: "The Ashen Coast" }, payload };
  writeWorldCreationRecovery("actor-a", { confirmed }, storage);
  const restored = readWorldCreationRecovery<typeof confirmed.world>("actor-a", storage);
  assert.deepEqual(restored.recovery.confirmed, confirmed);
  assert.equal(restored.recovery.pending, undefined);
});
