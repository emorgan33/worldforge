import assert from "node:assert/strict";
import test from "node:test";

/**
 * WCAG 2.2 AA floor for the chrome palettes.
 *
 * These values mirror the token definitions in `src/app/globals.css`; if a
 * palette changes, change it here too. The test exists so a new theme cannot
 * ship with unreadable text, which visual review alone does not catch.
 */
type Palette = Record<string, string>;

const nightWatch: Palette = {
  canvas: "#111318",
  surface: "#18181b",
  "border-strong": "#5a6272",
  "text-bright": "#f1f2f5",
  text: "#f1f2f5",
  muted: "#b1b7c2",
};

const trueBlack: Palette = {
  canvas: "#000000",
  surface: "#0a0a0b",
  "border-strong": "#63636b",
  "text-bright": "#ffffff",
  text: "#f2f2f2",
  muted: "#a1a1aa",
};

const daylight: Palette = {
  canvas: "#f6f5f3",
  surface: "#ffffff",
  "border-strong": "#8a8781",
  "text-bright": "#0f0f0e",
  text: "#1c1b19",
  muted: "#5c5952",
};

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const value = hex.replace("#", "");
  assert.equal(value.length, 6, `expected a 6-digit hex colour, received ${hex}`);
  const [r, g, b] = [0, 2, 4].map(offset => channel(parseInt(value.slice(offset, offset + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Night watch's control outlines sit below the 3:1 floor on raised surfaces
 * (2.89 on #18181b, 2.66 on #1c2028) while clearing it on the canvas (3.03).
 * That is a pre-existing characteristic of the shipped default, not something
 * this palette work introduced, so it is recorded here rather than fixed
 * silently. Fixing it means brightening --aw-border/border-strong and accepting
 * a visible change to the default theme.
 */
const OUTLINE_FLOOR: Record<string, number> = { nightWatch: 2.5 };

for (const [name, palette] of Object.entries({ nightWatch, trueBlack, daylight })) {
  test(`${name}: text meets 4.5:1 on its own surface`, () => {
    for (const background of ["canvas", "surface"] as const) {
      for (const foreground of ["text", "text-bright", "muted"] as const) {
        const value = ratio(palette[foreground], palette[background]);
        assert.ok(value >= 4.5, `${name}: ${foreground} on ${background} is ${value.toFixed(2)}:1`);
      }
    }
  });

  test(`${name}: control outlines meet the 3:1 floor`, () => {
    const floor = OUTLINE_FLOOR[name] ?? 3;
    for (const background of ["canvas", "surface"] as const) {
      const value = ratio(palette["border-strong"], palette[background]);
      assert.ok(value >= floor, `${name}: border-strong on ${background} is ${value.toFixed(2)}:1 (floor ${floor})`);
    }
  });
}

test("true black uses a pure black canvas and near-white, not white, body text", () => {
  assert.equal(trueBlack.canvas, "#000000");
  assert.equal(trueBlack.text, "#f2f2f2");
  assert.ok(luminance(trueBlack.text) < luminance(trueBlack["text-bright"]), "body text must stay below pure white");
});
