import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_THEME, isThemeId, resolveTheme, THEME_IDS, THEME_LABELS } from "../src/lib/theme";

test("accepts only declared theme identifiers", () => {
  for (const id of THEME_IDS) {
    assert.equal(isThemeId(id), true);
    assert.equal(typeof THEME_LABELS[id], "string");
  }
  for (const value of [null, undefined, "", "Dark", "nightwatch", "zinc", 1, {}, []]) {
    assert.equal(isThemeId(value), false, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test("the account value outranks the cookie", () => {
  assert.equal(resolveTheme("daylight", "night-watch"), "daylight");
  assert.equal(resolveTheme("system", "daylight"), "system");
});

test("falls back to the cookie, then the default", () => {
  assert.equal(resolveTheme(null, "daylight"), "daylight");
  assert.equal(resolveTheme(undefined, "system"), "system");
  assert.equal(resolveTheme(null, undefined), DEFAULT_THEME);
  assert.equal(resolveTheme("invalid", "invalid"), DEFAULT_THEME);
  assert.equal(resolveTheme("", ""), DEFAULT_THEME);
});

test("the default remains Night watch", () => {
  assert.equal(DEFAULT_THEME, "night-watch");
  assert.equal(THEME_IDS[0], "night-watch");
});
