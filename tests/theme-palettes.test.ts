import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contrastRatio, gamePalette, gameWorkspaceTokens, type GameTheme } from "../src/lib/theme-palettes";
import { WORLD_THEMES } from "../src/lib/world-appearance";

/**
 * The rule-system chrome palettes are derived in `src/lib/theme-palettes.ts`
 * and checked into `globals.css` so the theme attribute can switch without a
 * server round trip. These tests keep the two copies equal and keep the chrome
 * tied to the reader paper, ink and accent.
 */
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector} block in globals.css`);
  const declarations: Record<string, string> = {};
  for (const line of match[1].split(";")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    declarations[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return declarations;
}

const readerTheme: Record<GameTheme, keyof typeof WORLD_THEMES> = {
  pathfinder: "pf2remaster",
  dnd: "dnd2014",
};

for (const theme of ["pathfinder", "dnd"] as const) {
  const palette = gamePalette(theme);
  assert.ok(palette, `${theme} must have a palette`);
  const tokens = palette.tokens;
  const paper = WORLD_THEMES[readerTheme[theme]];
  const declared = block(`[data-theme="${theme}"]`);

  test(`${theme}: globals.css matches the shared palette module`, () => {
    const { ["color-scheme"]: scheme, ...declaredTokens } = declared;
    assert.equal(scheme, "light");
    assert.deepEqual(declaredTokens, tokens);
  });

  test(`${theme}: chrome reuses the reader paper, ink and accent`, () => {
    assert.equal(tokens["--color-app-surface"], paper.surface, "surface must be the reader paper");
    assert.equal(tokens["--color-app-text"], paper.text, "body ink must be the reader ink");
    assert.equal(tokens["--color-app-muted"], paper.muted, "muted ink must be the reader muted");
    assert.equal(tokens["--color-primary-500"], paper.accent, "primary fill must be the reader accent");
    assert.equal(declared["color-scheme"], "light");
  });

  test(`${theme}: chrome stays readable on its own surfaces`, () => {
    const pairs: Array<[string, string, number]> = [
      ["--color-app-text", "--color-app-canvas", 4.5],
      ["--color-app-text", "--color-app-surface", 4.5],
      ["--color-app-muted", "--color-app-surface", 4.5],
      ["--color-app-muted", "--color-app-canvas", 4.5],
      ["--color-app-subtle", "--color-app-canvas", 4.5],
      ["--color-app-faint", "--color-app-surface", 4.5],
      ["--color-app-faint", "--color-app-canvas", 4.5],
      ["--color-app-subtle-dim", "--color-app-surface", 4.5],
      ["--color-app-subtle-dim", "--color-app-canvas", 4.5],
      ["--color-app-border-strong", "--color-app-surface", 3],
      ["--color-app-border-strong", "--color-app-canvas", 3],
      ["--color-primary-200", "--color-app-surface", 4.5],
      ["--color-primary-300", "--color-app-surface", 4.5],
      ["--color-primary-400", "--color-app-surface", 4.5],
      ["--color-primary-500", "--color-app-surface", 4.5],
      ["--color-secondary-300", "--color-app-surface", 4.5],
      ["--color-secondary-400", "--color-app-surface", 4.5],
      ["--color-highlight-300", "--color-app-canvas", 3],
      ["--color-primary-200", "--color-primary-950", 4.5],
    ];
    for (const [foreground, background, floor] of pairs) {
      const value = contrastRatio(tokens[foreground], tokens[background]);
      assert.ok(value >= floor, `${theme}: ${foreground} on ${background} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${theme}: workspace chrome stays readable`, () => {
    const workspace = gameWorkspaceTokens(theme);
    assert.ok(workspace);
    const pairs: Array<[string, string, number]> = [
      ["--aw-text", "--aw-sidebar", 4.5],
      ["--aw-muted", "--aw-sidebar", 4.5],
      ["--aw-on-accent", "--aw-accent", 4.5],
      ["--aw-accent-soft-text", "--aw-accent-soft", 4.5],
      ["--aw-accent", "--aw-accent-soft", 3],
      ["--aw-sidebar-control-border", "--aw-sidebar", 3],
      ["--aw-text", "--aw-canvas", 4.5],
    ];
    for (const [foreground, background, floor] of pairs) {
      const value = contrastRatio(workspace[foreground], workspace[background]);
      assert.ok(value >= floor, `${theme}: ${foreground} on ${background} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${theme}: white labels clear the accent fills`, () => {
    for (const shade of ["--color-primary-500", "--color-primary-600", "--color-highlight-300", "--color-highlight-400", "--color-secondary-500", "--color-secondary-600"]) {
      const value = contrastRatio(tokens["--color-app-on-accent"], tokens[shade]);
      assert.ok(value >= 4.5, `${theme}: label on ${shade} is ${value.toFixed(2)}:1`);
    }
  });

}

test("the workspace mapping is shared and token-driven", () => {
  const index = css.indexOf('[data-theme="pathfinder"] .author-workspace');
  assert.ok(index >= 0, "missing workspace mapping");
  const block = css.slice(index, css.indexOf("}", index));
  for (const reference of [
    "--aw-canvas: var(--color-app-canvas);",
    "--aw-sidebar: var(--color-app-surface);",
    "--aw-accent: var(--color-primary-500);",
    "--aw-accent-soft-text: var(--color-primary-100);",
    "--aw-sidebar-control-border: var(--color-app-border-strong);",
  ]) {
    assert.ok(block.includes(reference), `workspace mapping is missing ${reference}`);
  }
});

test("dnd keeps its dark table as a tint instead of using it as canvas", () => {
  const palette = gamePalette("dnd");
  assert.ok(palette);
  assert.notEqual(palette.tokens["--color-app-canvas"], WORLD_THEMES.dnd2014.background);
  assert.ok(contrastRatio(palette.tokens["--color-app-text"], palette.tokens["--color-app-canvas"]) >= 4.5);
});
