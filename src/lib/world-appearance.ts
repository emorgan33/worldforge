import type { CSSProperties } from "react";
import postcss, { type AtRule, type Container, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
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

const ALLOWED_NESTED_AT_RULES = new Set(["media", "supports", "container", "starting-style"]);

function isReaderRootSelector(selectorText: string): boolean {
  let isRoot = false;
  selectorParser((selectors) => {
    isRoot = selectors.nodes.length === 1 && selectors.nodes[0].nodes.filter((node) => node.type !== "comment").length === 1;
    const node = selectors.nodes[0]?.nodes.find((entry) => entry.type !== "comment");
    isRoot = isRoot && node?.type === "class" && node.value === "wf-reader";
  }).processSync(selectorText);
  return isRoot;
}

function hasReaderRootBranch(selectorText: string): boolean {
  let found = false;
  selectorParser((selectors) => selectors.each((selector) => {
    const nodes = selector.nodes.filter((node) => node.type !== "comment");
    if (nodes[0]?.type !== "class" || nodes[0].value !== "wf-reader") return;
    // Only a single compound selects the wrapper itself. Descendant and child
    // selectors are contained by the wrapper, but their subject is a child.
    if (!nodes.some((node) => node.type === "combinator")) found = true;
  })).processSync(selectorText);
  return found;
}

function hasNestingNode(node: selectorParser.Node): boolean {
  if (node.type === "nesting") return true;
  return "nodes" in node && (node as selectorParser.Container).nodes.some(hasNestingNode);
}

function hasFunctionalNesting(selectorText: string): boolean {
  let hasUnsafeFunctionalBranch = false;
  selectorParser((selectors) => selectors.walkPseudos((pseudo) => {
    if (hasNestingNode(pseudo)) hasUnsafeFunctionalBranch = true;
  })).processSync(selectorText);
  return hasUnsafeFunctionalBranch;
}

function selectsReaderSibling(selectorText: string): boolean {
  let escapes = false;
  selectorParser((selectors) => selectors.each((selector) => {
    const nodes = selector.nodes.filter((node) => node.type !== "comment");
    nodes.forEach((node, index) => {
      if (node.type !== "combinator" || (node.value !== "+" && node.value !== "~")) return;
      // A leading sibling combinator is implicit nesting (`& +` / `& ~`).
      if (index === 0) {
        escapes = true;
        return;
      }
      // A sibling combinator escapes only when it follows the current nested
      // subject. Check the immediately preceding compound: an ancestor
      // qualifier such as `body &` does not move the nested subject off reader.
      const compoundStart = nodes.slice(0, index).findLastIndex((prior) => prior.type === "combinator") + 1;
      if (nodes.slice(compoundStart, index).some(hasNestingNode)) escapes = true;
    });
  })).processSync(selectorText);
  return escapes;
}

function preservesReaderSubject(selectorText: string): boolean {
  let preserves = false;
  selectorParser((selectors) => selectors.each((selector) => {
    const nodes = selector.nodes.filter((node) => node.type !== "comment");
    const compoundStart = nodes.findLastIndex((node) => node.type === "combinator") + 1;
    if (nodes.slice(compoundStart).some(hasNestingNode)) preserves = true;
  })).processSync(selectorText);
  return preserves;
}

function validateNestedScopes(container: Container, readerSubject = false): void {
  for (const node of container.nodes ?? []) {
    if (node.type === "atrule") {
      if (node.nodes) validateNestedScopes(node, readerSubject);
    } else if (node.type === "rule") {
      const rule = node as Rule;
      if (hasFunctionalNesting(rule.selector)) {
        throw rule.error("A functional selector cannot contain nested branches that may escape the reader presentation.");
      }
      if (readerSubject && selectsReaderSibling(rule.selector)) {
        throw rule.error("A nested selector cannot select a sibling outside the reader presentation.");
      }
      const nestedReaderSubject = hasReaderRootBranch(rule.selector) || (readerSubject && preservesReaderSubject(rule.selector));
      validateNestedScopes(rule, nestedReaderSubject);
    }
  }
}

function parseCustomCss(css: string) {
  if (css.length > 20_000) throw new Error("Custom CSS must be 20,000 characters or fewer.");
  const root = postcss.parse(css, { from: undefined });
  root.walkAtRules((rule) => {
    if (!ALLOWED_NESTED_AT_RULES.has(rule.name.toLowerCase()) || !rule.nodes) {
      throw rule.error(`The @${rule.name} at-rule is not supported in custom CSS.`);
    }
  });
  root.walkDecls((decl) => {
    const decodeEscapes = (value: string) => value.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_match, escaped: string) => {
      const hex = escaped.trim();
      if (/^[0-9a-f]{1,6}$/i.test(hex)) return String.fromCodePoint(parseInt(hex, 16));
      return escaped;
    });
    const normalized = decodeEscapes(`${decl.prop}:${decl.value}`).replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase();
    if (/^--[^:]+:.*\burl\s*\(/i.test(normalized) || /\bposition\s*:\s*(fixed|sticky)\b/i.test(normalized) || /\bz-index\s*:\s*[1-9]\d*/i.test(normalized)) {
      throw decl.error("Custom CSS contains disallowed declarations.");
    }
  });
  validateNestedScopes(root);
  return root;
}

function validateCustomCss(css: string): { valid: boolean; error?: string } {
  if (!css.trim()) return { valid: true };
  try {
    parseCustomCss(css);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Custom CSS is invalid." };
  }
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
  try {
    const root = parseCustomCss(trimmed);
    const scopeRules = (container: Container, nested = false) => {
      for (const node of [...container.nodes ?? []]) {
        if (node.type === "atrule") {
          if (node.nodes) scopeRules(node as AtRule, nested);
        } else if (node.type === "rule") {
          const rule = node as Rule;
          if (!nested) {
            rule.selector = selectorParser((selectors) => {
              selectors.each((selector) => {
                const text = selector.toString().trim();
                if (text === ".wf-reader" || isAlreadyScopedSelector(selector)) return;
                const first = selector.nodes[0];
                selector.prepend(selectorParser.combinator({ value: " " }));
                selector.prepend(selectorParser.className({ value: "wf-reader" }));
                if (first) first.spaces.before = "";
              });
            }).processSync(rule.selector);
          }
          scopeRules(rule, true);
        }
      }
    };
    scopeRules(root);
    return root.toString();
  } catch {
    // Persisted legacy CSS is parsed at render time too; malformed input must fail closed.
    return "";
  }
}

function isAlreadyScopedSelector(selector: selectorParser.Selector): boolean {
  const nodes = selector.nodes.filter((node) => node.type !== "comment");
  if (isReaderRootSelector(selector.toString())) return true;
  if (nodes[0]?.type !== "class" || nodes[0].value !== "wf-reader") return false;
  for (const node of nodes.slice(1)) {
    if (node.type !== "combinator") continue;
    if (node.value === "+" || node.value === "~") return false;
    return node.value === " " || node.value === ">";
  }
  return true;
}

export function rulesTheme(system: string): WorldAppearance["theme"] { return system === "PF_2E" ? "pf2remaster" : system === "DND_5E" ? "dnd2014" : "midnight"; }
