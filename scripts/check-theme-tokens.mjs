import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? "src";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const PREFIXES = [
  "bg", "text", "border", "border-l", "border-r", "border-t", "border-b",
  "border-x", "border-y", "from", "via", "to", "ring", "ring-offset",
  "divide", "placeholder", "fill", "stroke", "outline", "shadow",
  "decoration", "caret", "accent",
];
const FAMILIES = ["zinc", "amber", "indigo", "violet", "red", "emerald", "green", "sky"];
const SHADE = String.raw`\d{2,3}(?!\d)`;
const PATTERNS = [
  {
    name: "palette utility",
    pattern: new RegExp(String.raw`(?<![\w-])(?:${PREFIXES.join("|")})-(?:${FAMILIES.join("|")})-${SHADE}`, "g"),
  },
  {
    name: "palette reference",
    pattern: new RegExp(String.raw`var\(\s*--color-(?:${FAMILIES.join("|")})-\d+[^)]*\)`, "g"),
  },
];

// The token block itself aliases palette variables; nothing else may.
const ALIAS_FILE = path.join("app", "globals.css");

// Fixed black/white utilities bypass the theme layer. These files are allowed
// because their colours are content, not chrome: map annotations and their
// halos, rules/statblock art, and a caption scrim over a user image.
const FIXED_COLOR_PATTERN = /(?<![\w-])(?:text|bg|border|border-[trblxy]|from|via|to|ring|divide|outline|decoration)-(?:white|black)(?:\/\d{1,3})?(?![\w-])/g;
const FIXED_COLOR_ALLOW = new Set([
  path.join("components", "map", "InteractiveMap.tsx"),
  path.join("components", "blocks", "StatblockCard.tsx"),
  path.join("components", "blocks", "RulesIcons.tsx"),
  path.join("components", "blocks", "PathfinderActionSymbol.tsx"),
  path.join("components", "assets", "PlacementPreview.tsx"),
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.isFile()) return [];
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (entry.name.includes(".test.")) return [];
    return [full];
  });
}

const failures = [];
for (const file of sourceFiles(ROOT)) {
  const text = readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  if (!FIXED_COLOR_ALLOW.has(relative)) {
    for (const match of text.matchAll(FIXED_COLOR_PATTERN)) {
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`${file}:${line}: fixed colour ${JSON.stringify(match[0])}; use an app token`);
    }
  }
  for (const { name, pattern } of PATTERNS) {
    if (name === "palette reference" && path.relative(ROOT, file) === ALIAS_FILE) continue;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`${file}:${line}: ${name} ${JSON.stringify(match[0])}`);
    }
  }
}

if (failures.length) {
  console.error("Raw palette utilities are not allowed in src/; use the tokens defined in src/app/globals.css.\n");
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  console.error(`\n${failures.length} occurrence(s). See docs/feature-requests/application-themes.md.`);
  process.exitCode = 1;
} else {
  console.log("Theme tokens: no raw palette utilities in src/.");
}
