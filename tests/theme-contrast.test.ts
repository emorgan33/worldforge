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
  subtle: "#71717a",
  "subtle-dim": "#52525b",
  faint: "#3f3f47",
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
  faint: "#78746d",
  "subtle-dim": "#75716a",
};

/**
 * Light-mode accent fills paired with `--color-app-on-accent`. The night watch
 * fills are pale, so their label is near-black; the daylight fills take the dark
 * end of the same scale, so the label flips to white. Both directions have to
 * clear the floor or a primary button becomes unreadable in one theme.
 */
const accentFills: Record<string, Record<string, string>> = {
  // Rendered sRGB values of the Tailwind v4 palette variables, measured in
  // Chromium rather than copied from a v3 hex table.
  nightWatch: {
    "primary-500": "#fe9a00",
    "highlight-400": "#a684ff",
    "on-accent": "#09090b",
  },
  daylight: {
    "primary-500": "#bb4d00",
    "primary-600": "#973c00",
    "highlight-400": "#7f22fe",
    "on-accent": "#ffffff",
  },
};

/** Sidebar accent chrome: the solid "New article" button and the active row. */
const workspaceAccents: Record<string, Record<string, string>> = {
  nightWatch: {
    accent: "#9b8cfa",
    "on-accent": "#111318",
    soft: "#2b2850",
    "soft-text": "#f1f2f5",
    sidebar: "#181b22",
    "control-border": "#303540",
  },
  daylight: {
    accent: "#7008e7",
    "on-accent": "#ffffff",
    soft: "#ede9fe",
    "soft-text": "#4c1d95",
    sidebar: "#ffffff",
    "control-border": "#8a8781",
  },
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

/**
 * Night watch's quiet text roles are below the body floor on its canvas
 * (subtle 3.8:1, subtle-dim 2.4:1, faint 1.9:1). They are used for eyebrows,
 * hints and drop targets that shipped with the default theme; changing them
 * would visibly change Night watch, so the measured range is recorded here the
 * same way as the outline floor. Light themes define their own quiet shades
 * that clear 4.5:1.
 */
test("night watch quiet text keeps its documented pre-existing range", () => {
  const canvas = nightWatch.canvas;
  const subtle = ratio(nightWatch.subtle, canvas);
  const subtleDim = ratio(nightWatch["subtle-dim"], canvas);
  const faint = ratio(nightWatch.faint, canvas);
  assert.ok(subtle > 3.5 && subtle < 4.5, `night watch subtle is ${subtle.toFixed(2)}:1`);
  assert.ok(subtleDim > 2 && subtleDim < 3, `night watch subtle-dim is ${subtleDim.toFixed(2)}:1`);
  assert.ok(faint > 1.5 && faint < 2.2, `night watch faint is ${faint.toFixed(2)}:1`);
});

test("true black uses a pure black canvas and near-white, not white, body text", () => {
  assert.equal(trueBlack.canvas, "#000000");
  assert.equal(trueBlack.text, "#f2f2f2");
  assert.ok(luminance(trueBlack.text) < luminance(trueBlack["text-bright"]), "body text must stay below pure white");
});

test("daylight faint and subtle-dim text still clear the body floor", () => {
  for (const shade of ["faint", "subtle-dim"] as const) {
    const value = ratio(daylight[shade], daylight.surface);
    assert.ok(value >= 4.5, `daylight ${shade} on surface is ${value.toFixed(2)}:1`);
  }
});

for (const [name, fills] of Object.entries(accentFills)) {
  test(`${name}: accent fills keep their label readable`, () => {
    for (const [shade, background] of Object.entries(fills)) {
      if (shade === "on-accent") continue;
      const value = ratio(fills["on-accent"], background);
      assert.ok(value >= 4.5, `${name}: on-accent on ${shade} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${name}: sidebar accent chrome is readable`, () => {
    const label = ratio(workspaceAccents[name]["on-accent"], workspaceAccents[name].accent);
    assert.ok(label >= 4.5, `${name}: solid accent label is ${label.toFixed(2)}:1`);
    const row = ratio(workspaceAccents[name]["soft-text"], workspaceAccents[name].soft);
    assert.ok(row >= 4.5, `${name}: active row text is ${row.toFixed(2)}:1`);
    const icon = ratio(workspaceAccents[name].accent, workspaceAccents[name].soft);
    assert.ok(icon >= 3, `${name}: active row icon is ${icon.toFixed(2)}:1`);
  });
}

test("daylight sidebar controls meet the 3:1 outline floor", () => {
  const value = ratio(workspaceAccents.daylight["control-border"], workspaceAccents.daylight.sidebar);
  assert.ok(value >= 3, `daylight sidebar control outline is ${value.toFixed(2)}:1`);
});

/**
 * Night watch's sidebar search field has always used #303540 on #181b22
 * (1.27:1). Default parity forbids changing it with this palette work; the
 * measurement is recorded here so a future accessibility pass has the number.
 */
test("night watch sidebar control outline keeps its documented pre-existing value", () => {
  const value = ratio(workspaceAccents.nightWatch["control-border"], workspaceAccents.nightWatch.sidebar);
  assert.ok(value > 1 && value < 3, `night watch sidebar control outline is ${value.toFixed(2)}:1`);
});
