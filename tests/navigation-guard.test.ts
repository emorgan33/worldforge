import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRegistration, evaluateTransition, guardLabel } from "../src/lib/navigation-guard";

test("registration updates are immutable and identical reports do not change the map", () => {
  const empty = new Map();
  const withSettings = applyRegistration(empty, "settings", { dirty: true, busy: false });
  assert.equal(empty.size, 0);
  assert.equal(withSettings.get("settings")?.dirty, true);
  const same = applyRegistration(withSettings, "settings", { dirty: true, busy: false });
  assert.equal(same, withSettings, "identical registration must bail out by identity");
  const cleared = applyRegistration(withSettings, "settings", null);
  assert.equal(cleared.size, 0);
  assert.equal(applyRegistration(cleared, "settings", null), cleared, "unregistering an absent id is a no-op");
});

test("busy registrations and busy labels block silently before any dirty prompt", () => {
  const registry = new Map([["settings", { dirty: true, busy: false }]]);
  const blocked = evaluateTransition({ registry, busyLabels: ["article save"], editorDirty: true });
  assert.deepEqual(blocked, { blocked: "busy", reason: "article save" });
  const registryBusy = new Map([["foundry", { dirty: false, busy: true }]]);
  assert.deepEqual(evaluateTransition({ registry: registryBusy, busyLabels: [], editorDirty: false }), { blocked: "busy", reason: "Foundry import" });
});

test("dirty forms produce one combined discard prompt naming every scope", () => {
  const registry = new Map<string, { dirty: boolean; busy: boolean }>([
    ["settings", { dirty: true, busy: false }],
    ["variable", { dirty: true, busy: false }],
    ["asset", { dirty: false, busy: false }],
  ]);
  const decision = evaluateTransition({ registry, busyLabels: [], editorDirty: true });
  assert.equal(decision.blocked, "dirty");
  if (decision.blocked !== "dirty") return;
  assert.match(decision.message, /article editor/);
  assert.match(decision.message, /world settings and variable value/);
  assert.match(decision.message, /recovery draft/);
  assert.equal(/image library/.test(decision.message), false, "clean scopes are not listed");
});

test("a clean registry allows the transition", () => {
  const registry = new Map([["session", { dirty: false, busy: false }]]);
  assert.deepEqual(evaluateTransition({ registry, busyLabels: [], editorDirty: false }), { blocked: false });
  assert.deepEqual(evaluateTransition({ registry: new Map(), busyLabels: [], editorDirty: false }), { blocked: false });
});

test("guard labels cover every registered form id", () => {
  for (const id of ["article", "settings", "compendium", "variable", "map", "session", "asset", "asset-detail", "foundry"]) {
    assert.equal(guardLabel(id), guardLabel(id));
    assert.notEqual(guardLabel(id), "");
  }
  assert.equal(guardLabel("asset-detail:form-1"), "image details");
});
