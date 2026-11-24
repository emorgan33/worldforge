import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../scripts/check-theme-tokens.mjs", import.meta.url);

function run(root: string) {
  return spawnSync(process.execPath, [script.pathname, root], { encoding: "utf8" });
}

function withRoot(files: Record<string, string>, act: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "worldforge-tokens-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const file = join(root, name);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, contents);
    }
    act(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts token utilities and palette aliases", () => {
  withRoot({
    "app/globals.css": ":root { --color-app-canvas: var(--color-zinc-950); }",
    "components/Card.tsx": '<div className="bg-app-surface text-app-muted border border-app-border bg-primary-500/10" />',
    "notes.md": '<div className="bg-zinc-900" />',
    "tests/example.test.tsx": '<div className="bg-zinc-900" />',
  }, root => {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no raw palette utilities/);
  });
});

test("rejects palette utilities in every form", () => {
  withRoot({
    "a.tsx": '<div className="bg-zinc-900" />\n<div className="hover:text-amber-300" />',
    "nested/b/page.tsx": '<div className="border-t-indigo-400" />',
    "c.css": ".x { color: var(--color-red-500); }\n.y { @apply placeholder-violet-200; }",
    "d.ts": 'const value = "bg-[var(--color-red-500)]";',
  }, root => {
    const result = run(root);
    assert.equal(result.status, 1, "violations must fail the check");
    assert.match(result.stderr, /a\.tsx:1: palette utility "bg-zinc-900"/);
    assert.match(result.stderr, /a\.tsx:2: palette utility "hover:text-amber-300"|a\.tsx:2: palette utility "text-amber-300"/);
    assert.match(result.stderr, /page\.tsx:1: palette utility "border-t-indigo-400"/);
    assert.match(result.stderr, /palette utility "placeholder-violet-200"/);
    assert.match(result.stderr, /palette arbitrary value "\[var\(--color-red-500\)\]"/);
  });
});

test("rejects palette variable references outside the token block", () => {
  withRoot({
    "app/globals.css": ":root { --color-app-canvas: var(--color-zinc-950); }",
    "components/Legacy.module.css": ".card { color: var(--color-zinc-400); }",
  }, root => {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Legacy\.module\.css:1: palette variable reference "var\(--color-zinc-400\)"/);
    assert.equal(result.stderr.match(/palette variable reference/g)?.length, 1, "the token block must be exempt");
  });
});

test("accepts arbitrary values that are not palette variables", () => {
  withRoot({
    "a.tsx": '<div className="bg-[#201c17] text-[var(--aw-text)]" />',
  }, root => {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });
});
