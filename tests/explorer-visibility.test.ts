import assert from "node:assert/strict";
import { test } from "node:test";
import { isArticleView, resolveExplorerVisibility } from "../src/lib/explorer-visibility";

test("article views include reading, editing and category management", () => {
  for (const view of ["article", "editor", "manager"]) assert.equal(isArticleView(view), true);
  for (const view of ["home", "map", "sessions", "assets", "blocks", "gm", "variables", "timeline"]) assert.equal(isArticleView(view), false);
});

test("the explorer is contextual to article views unless pinned or explicitly opened", () => {
  const base = { pinned: false, collapsed: false };
  assert.equal(resolveExplorerVisibility({ ...base, view: "article" }), true);
  assert.equal(resolveExplorerVisibility({ ...base, view: "editor" }), true);
  assert.equal(resolveExplorerVisibility({ ...base, view: "manager" }), true);
  assert.equal(resolveExplorerVisibility({ ...base, view: "map" }), false);
  assert.equal(resolveExplorerVisibility({ ...base, view: "map", forcedOpen: true }), true);
  assert.equal(resolveExplorerVisibility({ ...base, view: "home", pinned: true }), true);
});

test("an explicit collapse wins over pinning and contextual visibility", () => {
  for (const view of ["article", "map"]) {
    assert.equal(resolveExplorerVisibility({ view, pinned: true, collapsed: true }), false);
    assert.equal(resolveExplorerVisibility({ view, pinned: false, collapsed: true, forcedOpen: true }), false);
  }
});
