import type { CSSProperties } from "react";
import { isImageReference } from "./assets";

export const WORLD_THEMES = {
  dnd2014: { label: "D&D 5e · 2014", background: "#30231e", surface: "#eee5ce", text: "#181818", muted: "#635648", border: "#c0ad6a", accent: "#58180d" },
  pf2remaster: { label: "Pathfinder 2e · Remaster", background: "#ede3c7", surface: "#ffffff", text: "#181818", muted: "#515c63", border: "#644117", accent: "#002a16" },
  midnight: { label: "Midnight", background: "#09090b", surface: "#18181b", text: "#f4f4f5", muted: "#b4b4bd", border: "#52525b", accent: "#a5b4fc" },
  parchment: { label: "Parchment", background: "#d6c5a4", surface: "#fff6e5", text: "#30291f", muted: "#645746", border: "#a18a69", accent: "#78451c" },
  forest: { label: "Deep forest", background: "#081510", surface: "#12291f", text: "#ecf5e9", muted: "#b2c9b8", border: "#466b54", accent: "#a3d9a5" },
} as const;
export const READING_WIDTHS = { narrow: "680px", standard: "900px", wide: "1120px" } as const;
export interface WorldAppearance {
  theme: keyof typeof WORLD_THEMES;
  backgroundColor: string;
  backgroundImage: string;
  accentColor: string;
  readingWidth: keyof typeof READING_WIDTHS;
  customCss?: string;
}
export const DEFAULT_APPEARANCE: WorldAppearance = { theme: "midnight", backgroundColor: "", backgroundImage: "", accentColor: "", readingWidth: "wide" };
const color = (value: unknown): value is string => typeof value === "string" && (value === "" || /^#[0-9a-f]{6}$/i.test(value));

// Validate that custom CSS is scoped to reader presentation and contains no dangerous patterns
function validateCustomCss(css: string): { valid: boolean; error?: string } {
  if (!css || typeof css !== "string") return { valid: true };
  const trimmed = css.trim();
  if (!trimmed) return { valid: true };
  
  // Check for dangerous patterns that could affect author controls or other worlds
  const dangerousPatterns = [
    /@import/i, /@charset/i, /@font-face/i,
    /--.*:\s*url\s*\(/i,
    /position:\s*fixed/i, /position:\s*sticky/i,
    /z-index:\s*[1-9]/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: "Custom CSS contains disallowed patterns." };
    }
  }
  
  // Validate CSS syntax - basic check for balanced braces
  const openBraces = (trimmed.match(/{/g) || []).length;
  const closeBraces = (trimmed.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { valid: false, error: "Custom CSS has unbalanced braces." };
  }
  
  return { valid: true };
}

export function validateAppearance(value: unknown): WorldAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid world appearance settings.");
  const input = value as Record<string, unknown>;
  if (typeof input.theme !== "string" || !Object.hasOwn(WORLD_THEMES, input.theme) || typeof input.readingWidth !== "string" || !Object.hasOwn(READING_WIDTHS, input.readingWidth) || !color(input.backgroundColor) || !color(input.accentColor) || !isImageReference(input.backgroundImage)) throw new Error("Choose a supported theme, reading width, hex colors and image URL.");
  
  if (input.customCss !== undefined && input.customCss !== null) {
    if (typeof input.customCss !== "string") throw new Error("Custom CSS must be a string.");
    const cssValidation = validateCustomCss(input.customCss);
    if (!cssValidation.valid) throw new Error(cssValidation.error);
  }
  
  return { 
    theme: input.theme as WorldAppearance["theme"], 
    readingWidth: input.readingWidth as WorldAppearance["readingWidth"], 
    backgroundColor: input.backgroundColor, 
    accentColor: input.accentColor, 
    backgroundImage: (input.backgroundImage as string || "").trim(),
    customCss: (input.customCss as string || "").trim() || undefined,
  };
}
export function parseAppearance(value?: string | null): WorldAppearance {
  try { return validateAppearance(JSON.parse(value || "null")); } catch { return { ...DEFAULT_APPEARANCE }; }
}
function luminance(color: string) {
  const values = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
export function contrastRatio(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function readableAccent(accent: string, surface: string) {
  const target = luminance(surface) > .179 ? 0 : 255;
  let result = accent;
  for (let step = 0; step <= 20; step++) {
    result = "#" + [1, 3, 5].map(offset => Math.round(parseInt(accent.slice(offset, offset + 2), 16) * (1 - step / 20) + target * step / 20).toString(16).padStart(2, "0")).join("");
    if (contrastRatio(result, surface) >= 4.5) break;
  }
  return result;
}
export function appearanceStyles(appearance: WorldAppearance): CSSProperties {
  const theme = WORLD_THEMES[appearance.theme];
  return {
    "--world-surface": theme.surface, "--world-text": theme.text, "--world-muted": theme.muted, "--world-border": theme.border,
    "--world-accent": readableAccent(appearance.accentColor || theme.accent, theme.surface),
    "--world-width": READING_WIDTHS[appearance.readingWidth],
    backgroundColor: appearance.backgroundColor || theme.background,
    backgroundImage: appearance.backgroundImage ? `url(${JSON.stringify(appearance.backgroundImage)})` : "none",
    colorScheme: ["parchment", "dnd2014", "pf2remaster"].includes(appearance.theme) ? "light" : "dark",
  } as CSSProperties;
}

// Generate scoped custom CSS that only applies to the reader presentation
export function scopedCustomCss(css: string): string {
  if (!css || typeof css !== "string") return "";
  const trimmed = css.trim();
  if (!trimmed) return "";
  
  // Wrap all selectors with .wf-reader scope
  // Split at commas that are NOT inside parentheses (attribute selectors)
  const splitSelectors = (selectors: string): string[] => {
    const parts: string[] = [];
    let current = "";
    let parenDepth = 0;
    for (const ch of selectors) {
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      if (ch === "," && parenDepth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  };
  
  const scopedCss = trimmed.replace(/([^{]+)(\{[^}]+\})/g, (_match, selector, ruleBlock) => {
    const trimmedSelector = selector.trim();
    // Skip @-rules, already scoped selectors, CSS variables, and comments
    if (trimmedSelector.startsWith("@") || trimmedSelector.startsWith(".wf-reader") || trimmedSelector.startsWith("--") || trimmedSelector.startsWith("/*")) return _match;
    // Handle comma-separated selectors, scoping each, accounting for attribute selectors containing commas
    const scoped = splitSelectors(trimmedSelector).map((s: string) => ".wf-reader " + s.trim()).join(", ");
    return scoped + " " + ruleBlock;
  });
  
  return scopedCss;
}

export function rulesTheme(system: string): WorldAppearance["theme"] { return system === "PF_2E" ? "pf2remaster" : system === "DND_5E" ? "dnd2014" : "midnight"; }
