/**
 * Chrome palettes for the two rule-system themes.
 *
 * The reader already defines these campaigns' paper, ink and accent in
 * `WORLD_THEMES`. The chrome reuses those values rather than re-picking them,
 * so a Pathfinder campaign and a Pathfinder workspace cannot drift apart. The
 * remaining chrome roles are derived here with one mix/contrast rule set, not
 * hand-picked in components.
 *
 * Values are returned as CSS custom properties. The checked-in `globals.css`
 * blocks carry the generated copy so the client-side theme attribute can switch
 * without a server round trip; `tests/theme-palettes.test.ts` fails if the two
 * copies drift.
 */
import { WORLD_THEMES } from "./world-appearance";
import type { ThemeId } from "./theme";

export const GAME_THEMES = ["pathfinder", "dnd"] as const;
export type GameTheme = (typeof GAME_THEMES)[number];

export function isGameTheme(theme: ThemeId): theme is GameTheme {
  return (GAME_THEMES as readonly string[]).includes(theme);
}

type Hex = string;

function parse(hex: Hex): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function hex(rgb: number[]): Hex {
  return "#" + rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
}

/** Mix `b` into `a`; `weight` is the share of `b`. */
export function mix(a: Hex, b: Hex, weight: number): Hex {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return hex([ar + (br - ar) * weight, ag + (bg - ag) * weight, ab + (bb - ab) * weight]);
}

export function darken(color: Hex, amount: number): Hex {
  return mix(color, "#000000", amount);
}

export function lighten(color: Hex, amount: number): Hex {
  return mix(color, "#ffffff", amount);
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Hex): number {
  const [r, g, b] = parse(color).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: Hex, background: Hex): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Fade a colour toward the surface for hint text, stopping before it drops
 * below the body floor against *any* chrome background it can land on. The
 * canvas and surface can sit on opposite sides of a faded ink, so both are
 * checked; the floor leaves headroom for translucent surface blends.
 */
function fade(color: Hex, backgrounds: Hex[], maxWeight: number, floor = 4.7): Hex {
  let result = color;
  for (let step = 1; step <= Math.round(maxWeight * 100); step++) {
    const candidate = mix(color, backgrounds[1], step / 100);
    if (backgrounds.some(background => contrastRatio(candidate, background) < floor)) break;
    result = candidate;
  }
  return result;
}

/**
 * Light-theme accent ramp. Dark shades (50–700) carry text, borders and solid
 * fills; 800–950 are tints used behind them. The mid shade is the reader accent
 * itself, so buttons and links match the campaign paper. Shades are roles, not
 * a monotone ramp: two quiet foreground roles may resolve to the same value
 * once the contrast floor is applied.
 */
function accentRamp(name: "primary" | "secondary" | "highlight", base: Hex) {
  const tokens: Record<string, string> = {};
  const shades: Record<string, Hex> = {
    50: darken(base, 0.35),
    100: darken(base, 0.26),
    200: darken(base, 0.18),
    300: darken(base, 0.26),
    400: darken(base, 0.24),
    500: base,
    600: darken(base, 0.12),
    700: darken(base, 0.22),
    800: lighten(base, 0.62),
    900: lighten(base, 0.80),
    950: lighten(base, 0.90),
  };
  for (const [shade, value] of Object.entries(shades)) tokens[`--color-${name}-${shade}`] = value;
  return tokens;
}

/**
 * D&D's printed border is decorative (1.8:1 on parchment); the plan's control
 * outline is the derived strong gold below.
 */
const DND_OUTLINE = "#8a6a2f";

const SOURCES = {
  pathfinder: {
    paper: WORLD_THEMES.pf2remaster,
    outline: WORLD_THEMES.pf2remaster.border,
    secondary: WORLD_THEMES.pf2remaster.border,
  },
  dnd: {
    paper: WORLD_THEMES.dnd2014,
    outline: DND_OUTLINE,
    secondary: DND_OUTLINE,
  },
} as const;

export interface GamePalette {
  /**
   * Reader values used by the chrome. `background` is the chrome canvas: the
   * reader background for Pathfinder, a paper shade for D&D (see below).
   */
  paper: { background: string; surface: string; text: string; muted: string; accent: string; outline: string };
  tokens: Record<string, string>;
}

export function gamePalette(theme: ThemeId): GamePalette | null {
  if (!isGameTheme(theme)) return null;
  const { paper, outline, secondary } = SOURCES[theme];
  const surface = paper.surface;
  const accent = paper.accent;
  // Pathfinder's reader background is already a paper tone. D&D's is the dark
  // table the parchment sits on, so the chrome takes a paper shade tinted by
  // that backdrop instead; using it verbatim would put #181818 ink on #30231e.
  const canvas = theme === "dnd" ? mix(surface, paper.background, 0.08) : paper.background;

  const tokens: Record<string, string> = {
    "--color-app-canvas": canvas,
    "--color-app-surface": surface,
    "--color-app-raised": mix(canvas, surface, 0.55),
    "--color-app-control": surface,
    "--color-app-control-strong": mix(surface, paper.text, 0.08),
    "--color-app-tint": mix(surface, paper.text, 0.12),
    "--color-app-border": mix(surface, paper.text, 0.2),
    "--color-app-border-strong": outline,
    "--color-app-border-emphasis": mix(outline, paper.text, 0.3),
    "--color-app-border-emphasis-strong": mix(outline, paper.text, 0.55),
    "--color-app-border-contrast": mix(paper.text, surface, 0.2),
    "--color-app-text-bright": paper.text,
    "--color-app-text-strong": paper.text,
    "--color-app-text": paper.text,
    "--color-app-text-dim": mix(paper.text, surface, 0.2),
    "--color-app-muted": paper.muted,
    "--color-app-subtle": fade(paper.muted, [canvas, surface], 0.2),
    "--color-app-subtle-dim": fade(paper.muted, [canvas, surface], 0.32),
    "--color-app-faint": fade(paper.muted, [canvas, surface], 0.42),
    "--color-app-on-accent": "#ffffff",
    ...accentRamp("primary", accent),
    ...accentRamp("secondary", secondary),
    ...accentRamp("highlight", accent),
  };

  return {
    paper: { background: canvas, surface, text: paper.text, muted: paper.muted, accent, outline },
    tokens,
  };
}

/**
 * Workspace-only tokens resolved to values. `globals.css` expresses the same
 * mapping as `var(--color-*)` references on the workspace element; this helper
 * gives tests and any future consumer the resolved form.
 */
export function gameWorkspaceTokens(theme: ThemeId): Record<string, string> | null {
  const palette = gamePalette(theme);
  if (!palette) return null;
  const t = palette.tokens;
  return {
    "--aw-canvas": t["--color-app-canvas"],
    "--aw-sidebar": t["--color-app-surface"],
    "--aw-panel": t["--color-app-surface"],
    "--aw-control": t["--color-app-control-strong"],
    "--aw-border": t["--color-app-border"],
    "--aw-text": t["--color-app-text"],
    "--aw-muted": t["--color-app-muted"],
    "--aw-accent": t["--color-primary-500"],
    "--aw-accent-hover": t["--color-primary-700"],
    "--aw-accent-soft": t["--color-primary-950"],
    "--aw-accent-soft-text": t["--color-primary-100"],
    "--aw-on-accent": "#ffffff",
    "--aw-sidebar-border": t["--color-app-border"],
    "--aw-sidebar-muted": t["--color-app-muted"],
    "--aw-sidebar-control": t["--color-app-control-strong"],
    "--aw-sidebar-control-border": t["--color-app-border-strong"],
  };
}
