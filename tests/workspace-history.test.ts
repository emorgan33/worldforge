import assert from "node:assert/strict";
import { test } from "node:test";
import { WORLD_HISTORY_INDEX_KEY } from "../src/lib/world-selection";
import { WorkspaceHistoryCoordinator } from "../src/lib/workspace-history";

const state = (index: number) => ({ [WORLD_HISTORY_INDEX_KEY]: index, __NA: true, tree: { preserved: true } });

test("history markers preserve router state and commit each workspace push once", () => {
  const history = new WorkspaceHistoryCoordinator();
  assert.deepEqual(history.initialize({ __NA: true, tree: ["router"] }), {
    __NA: true, tree: ["router"], [WORLD_HISTORY_INDEX_KEY]: 0,
  });
  assert.equal(history.initialize(state(7)), null);
  history.markPush();
  assert.deepEqual(history.commitPendingPush(state(7)), { ...state(7), [WORLD_HISTORY_INDEX_KEY]: 8 });
  assert.equal(history.commitPendingPush(state(8)), null);
});

test("cancelled Back compensates once, suppresses its pop, and repeated Back/Forward stays usable", () => {
  const history = new WorkspaceHistoryCoordinator();
  history.initialize(state(2));
  const denied = history.onPop(state(1), "world-a", "world-b", () => false);
  assert.deepEqual(denied, { kind: "cancelled", compensation: 1 });
  assert.equal(history.returnToIndex, null);
  assert.equal(history.onPop(state(2), "world-b", "world-b", () => true).kind, "suppressed");
  assert.equal(history.shouldSkipCancelledDestination("world-a"), true);
  assert.equal(history.shouldSkipCancelledDestination("world-b"), false);
  assert.equal(history.onPop(state(1), "world-a", "world-b", () => true).kind, "accepted");
  assert.equal(history.acceptedDestinationIs("world-a"), true);
  assert.equal(history.returnToIndex, 2);
  assert.equal(history.onPop(state(2), "world-b", "world-a", () => true).kind, "accepted");
  assert.equal(history.returnToIndex, 2);
  assert.equal(history.onPop(state(1), "world-a", "world-b", () => true).kind, "accepted");
  assert.equal(history.returnToIndex, 2);
});

test("cancelled destination bootstrap skips stale URL echo until compensation URL arrives", () => {
  const history = new WorkspaceHistoryCoordinator();
  history.initialize(state(4));
  assert.equal(history.onPop(state(3), "missing-world", "world-current", () => false).kind, "cancelled");
  assert.equal(history.shouldSkipCancelledDestination("missing-world"), true);
  assert.equal(history.shouldSkipCancelledDestination("world-current"), false);
  assert.equal(history.onPop(state(4), "world-current", "world-current", () => true).kind, "suppressed");
});

test("return-to-current index is captured once and cleared when returning to the mounted world", () => {
  const history = new WorkspaceHistoryCoordinator();
  history.initialize(state(5));
  history.onPop(state(3), "world-destination", "world-current", () => true);
  assert.equal(history.returnToIndex, 5);
  history.onPop(state(2), "world-other", "world-destination", () => true);
  assert.equal(history.returnToIndex, 5);
  history.onPop(state(5), "world-current", "world-current", () => true);
  assert.equal(history.returnToIndex, null);
});
