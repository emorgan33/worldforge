import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, WORLD_THEMES, contrastRatio, parseAppearance, readableAccent, scopedCustomCss, validateAppearance } from "../src/lib/world-appearance";

test("legacy and invalid appearance data falls back without partial CSS values", () => {
  for (const value of [null, "", "{", JSON.stringify({ theme: "parchment" }), JSON.stringify({ ...DEFAULT_APPEARANCE, backgroundColor: "red;display:none" })]) assert.deepEqual(parseAppearance(value), DEFAULT_APPEARANCE);
  for (const value of [{ ...DEFAULT_APPEARANCE, theme: "__proto__" }, { ...DEFAULT_APPEARANCE, readingWidth: "100vw" }, { ...DEFAULT_APPEARANCE, accentColor: "#fff" }, { ...DEFAULT_APPEARANCE, backgroundImage: "javascript:alert(1)" }]) assert.throws(() => validateAppearance(value));
});

test("custom CSS validation rejects dangerous patterns", () => {
  // Valid CSS should pass
  const validCss = ".wf-reader h1 { color: #ff0000; }";
  const result = validateAppearance({ ...DEFAULT_APPEARANCE, customCss: validCss });
  assert.equal(result.customCss, validCss);
  assert.equal(result.theme, DEFAULT_APPEARANCE.theme);
  
  // Empty/null CSS should be allowed and normalized
  const emptyResult = validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "" });
  assert.equal(emptyResult.customCss, undefined);
  
  const undefinedResult = validateAppearance({ ...DEFAULT_APPEARANCE, customCss: undefined });
  assert.equal(undefinedResult.customCss, undefined);
  
  // Dangerous patterns should be rejected
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "@import url('https://evil.com');" }));
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "body { position: fixed; }" }));
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: ".class { z-index: 999; }" }));
  
  // Unbalanced braces should be rejected
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: ".class { color: red" }));
});

test("scoped custom CSS wraps selectors with .wf-reader prefix", () => {
  // Basic selector gets scoped
  assert.equal(scopedCustomCss("h1 { color: blue; }"), ".wf-reader h1 { color: blue; }");
  
  // Multiple selectors get scoped
  assert.equal(scopedCustomCss("h1, h2 { font-size: 2em; }"), ".wf-reader h1, .wf-reader h2 { font-size: 2em; }");
  
  // Already scoped selectors stay as-is
  assert.equal(scopedCustomCss(".wf-reader h1 { color: red; }"), ".wf-reader h1 { color: red; }");
  
  // CSS variables and @-rules stay as-is
  assert.equal(scopedCustomCss("--my-color: red;"), "--my-color: red;");
  assert.equal(scopedCustomCss("@media (min-width: 768px) { h1 { font-size: 2em; } }"), "@media (min-width: 768px) { h1 { font-size: 2em; } }");
  
  // Empty or whitespace-only returns empty
  assert.equal(scopedCustomCss(""), "");
  assert.equal(scopedCustomCss("   "), "");
});

test("all theme text and custom accent colors meet reading-surface contrast", () => {
  for (const theme of Object.values(WORLD_THEMES)) {
    assert(contrastRatio(theme.text, theme.surface) >= 4.5);
    assert(contrastRatio(theme.muted, theme.surface) >= 4.5);
    for (const accent of [theme.accent, "#ffffff", "#000000", "#ffff00", "#123456", theme.surface]) assert(contrastRatio(readableAccent(accent, theme.surface), theme.surface) >= 4.5);
  }
});
