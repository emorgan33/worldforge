import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORY_ICON_SIZES,
  IMAGE_PLACEMENT_PURPOSES,
  MAX_PLACEMENT_ALT_LENGTH,
  PLACEMENT_GEOMETRY,
  PLACEMENT_LABELS,
  isDecorativePlacementAlt,
  normalizePlacementAlt,
  resolvePlacementAlt,
  validatePlacementAlt,
} from "../src/lib/image-placement";

test("every placement purpose has a label and documented geometry", () => {
  for (const purpose of IMAGE_PLACEMENT_PURPOSES) {
    assert.equal(typeof PLACEMENT_LABELS[purpose], "string");
    assert.ok(PLACEMENT_LABELS[purpose].length > 0);
  }
  for (const purpose of ["article-cover", "world-cover", "portrait", "body"] as const) {
    assert.ok(PLACEMENT_GEOMETRY[purpose].frameClassName.length > 0);
    assert.ok(PLACEMENT_GEOMETRY[purpose].imageClassName.length > 0);
  }
  assert.deepEqual([...CATEGORY_ICON_SIZES], [16, 24, 32]);
});

test("placement descriptions preserve legacy, decorative and descriptive states", () => {
  // null/undefined keep the renderer's legacy fallback (usually the article title).
  assert.equal(resolvePlacementAlt(null, "Title"), "Title");
  assert.equal(resolvePlacementAlt(undefined, "Title"), "Title");
  // Empty string is explicitly decorative: no fallback is substituted.
  assert.equal(resolvePlacementAlt("", "Title"), "");
  assert.equal(isDecorativePlacementAlt(""), true);
  assert.equal(isDecorativePlacementAlt(null), false);
  // A description is used verbatim.
  assert.equal(resolvePlacementAlt("A lone tower at dusk", "Title"), "A lone tower at dusk");
});

test("placement descriptions validate length and type", () => {
  assert.equal(validatePlacementAlt(undefined), null);
  assert.equal(validatePlacementAlt(null), null);
  assert.equal(validatePlacementAlt(""), null);
  assert.equal(validatePlacementAlt("ok"), null);
  assert.equal(validatePlacementAlt("x".repeat(MAX_PLACEMENT_ALT_LENGTH)), null);
  assert.match(validatePlacementAlt("x".repeat(MAX_PLACEMENT_ALT_LENGTH + 1))!, /under/);
  assert.match(validatePlacementAlt(42)!, /text/);
});

test("placement descriptions normalize without inventing a value", () => {
  assert.equal(normalizePlacementAlt(undefined), undefined);
  assert.equal(normalizePlacementAlt(null), null);
  assert.equal(normalizePlacementAlt(""), "");
  assert.equal(normalizePlacementAlt("descriptive"), "descriptive");
  assert.equal(normalizePlacementAlt(7), null);
});
