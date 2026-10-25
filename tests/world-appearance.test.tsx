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

test("scoped custom CSS structurally scopes selectors and nested rules", () => {
  assert.equal(scopedCustomCss("h1 { color: blue; }"), ".wf-reader h1 { color: blue; }");
  assert.equal(scopedCustomCss("h1, h2 { font-size: 2em; }"), ".wf-reader h1,.wf-reader h2 { font-size: 2em; }");
  assert.equal(scopedCustomCss(".wf-reader h1 { color: red; }"), ".wf-reader h1 { color: red; }");
  assert.equal(scopedCustomCss(".wf-reader:not(.missing) { color: red; }"), ".wf-reader:not(.missing) { color: red; }");
  assert.equal(scopedCustomCss(".wf-reader.special { color: red; }"), ".wf-reader.special { color: red; }");
  assert.equal(scopedCustomCss('.wf-reader[data-theme="midnight"] h1 { color: red; }'), '.wf-reader[data-theme="midnight"] h1 { color: red; }');
  assert.equal(scopedCustomCss(".wf-reader h1 { & + h2 { color: red; } }"), ".wf-reader h1 { & + h2 { color: red; } }");
  assert.equal(scopedCustomCss(".wf-reader > h1 { & + h2 { color: red; } }"), ".wf-reader > h1 { & + h2 { color: red; } }");
  assert.equal(scopedCustomCss(".wf-reader h1, .wf-reader h2 { & + h3 { color: red; } }"), ".wf-reader h1, .wf-reader h2 { & + h3 { color: red; } }");
  assert.equal(scopedCustomCss(".wf-reader h1 { @media all { & + h2 { color: red; } } }"), ".wf-reader h1 { @media all { & + h2 { color: red; } } }");
  assert.equal(scopedCustomCss(".wf-reader  + .outside { color: red; }"), ".wf-reader .wf-reader  + .outside { color: red; }");
  assert.equal(scopedCustomCss(".wf-reader /*comment*/ + .outside { color: red; }"), ".wf-reader .wf-reader  + .outside { color: red; }");
  assert.equal(scopedCustomCss('a[data-label="one,two"], :is(h1, h2) { color: red; }'), '.wf-reader a[data-label="one,two"],.wf-reader :is(h1, h2) { color: red; }');
  assert.equal(scopedCustomCss('[data-label=".wf-reader  quoted"] { color: red; }'), '.wf-reader [data-label=".wf-reader  quoted"] { color: red; }');
  assert.equal(scopedCustomCss("/* lead */ h1 { color: red; }"), "/* lead */ .wf-reader h1 { color: red; }");
  assert.equal(scopedCustomCss("@media (min-width: 768px) { h1, h2 { font-size: 2em; } }"), "@media (min-width: 768px) { .wf-reader h1,.wf-reader h2 { font-size: 2em; } }");
  assert.equal(scopedCustomCss("@supports (display: grid) { @media (width > 40rem) { main { display: grid; } } }"), "@supports (display: grid) { @media (width > 40rem) { .wf-reader main { display: grid; } } }");
  assert.equal(scopedCustomCss(".wf-reader { h1 { color: red; } }"), ".wf-reader { h1 { color: red; } }");
  assert.equal(scopedCustomCss(".wf-reader { @media (min-width: 40rem) { h1 { color: red; } } }"), ".wf-reader { @media (min-width: 40rem) { h1 { color: red; } } }");
  assert.equal(scopedCustomCss(".wf-reader { & + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader:not(.missing) { & + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader.special { ~ .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss('.wf-reader[data-theme="midnight"] { @media all { + .outside { color: red; } } }'), "");
  assert.equal(scopedCustomCss(".wf-reader.special { & { ~ .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { body & + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { body > & + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { body & { & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { @media all { body & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { @media all { & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { @supports (display: grid) { & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { &.wf-reader + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { :is(&) + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { :is(&, .outside) { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { :is(.outside, &) { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { :where(:is(&, .outside)) { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { h1 { :is(&, .outside) { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { h1 { :is(body:has(&)) { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { ~ .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader, h1 { & + .outside { color: red; } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { &, h1 { & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(".wf-reader { & { & + .outside { color: red; } } }"), "");
  assert.equal(scopedCustomCss(""), "");
  assert.equal(scopedCustomCss("   "), "");
  assert.equal(scopedCustomCss("@keyframes flash { from { opacity: 0; } to { opacity: 1; } }"), "");
  assert.equal(scopedCustomCss("@layer reset { h1 { color: red; } }"), "");
  assert.equal(scopedCustomCss("@unknown rule { h1 { color: red; } }"), "");
});

test("custom CSS parser rejects malformed syntax and obfuscated unsafe declarations", () => {
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "h1 { color: red" }));
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "h1 { position/**/: fixed; }" }));
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "h1 { p\\6fsition: fixed; }" }));
  assert.throws(() => validateAppearance({ ...DEFAULT_APPEARANCE, customCss: "h1 { z-index: 900; }" }));
});

test("all theme text and custom accent colors meet reading-surface contrast", () => {
  for (const theme of Object.values(WORLD_THEMES)) {
    assert(contrastRatio(theme.text, theme.surface) >= 4.5);
    assert(contrastRatio(theme.muted, theme.surface) >= 4.5);
    for (const accent of [theme.accent, "#ffffff", "#000000", "#ffff00", "#123456", theme.surface]) assert(contrastRatio(readableAccent(accent, theme.surface), theme.surface) >= 4.5);
  }
});
