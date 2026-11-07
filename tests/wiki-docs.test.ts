import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkWiki } from "../scripts/check-wiki.mjs";

const labels = '\n**Source owner:** `fixture`.\n**Verified against:** `test-commit`.\n';

test("tracked wiki has complete navigation, page links and verification labels", async () => {
  const result = await checkWiki(new URL("../wiki/", import.meta.url));
  assert.deepEqual(result.errors, []);
});

test("wiki check rejects missing pages, headings, labels and sidebar entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-check-"));
  try {
    await writeFile(join(root, "Home.md"), "# Home\n[Broken](Absent)\n[Heading](Home#absent)\n");
    await writeFile(join(root, "_Sidebar.md"), "# Sidebar\n" + labels);
    const { errors } = await checkWiki(root, ["Home", "Required"]);
    for (const fragment of ["Missing required page", "missing source owner", "missing verification baseline",
      "missing link target", "missing heading", "absent from sidebar"]) {
      assert.ok(errors.some((error: string) => error.includes(fragment)), fragment);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wiki check accepts page extensions, anchors and external links", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-check-"));
  try {
    await writeFile(join(root, "Home.md"), '# Home\n## A heading\n[Self](#a-heading)\n[External](https://example.com)\n' + labels);
    await writeFile(join(root, "_Sidebar.md"), "[Home](Home.md#a-heading)\n" + labels);
    assert.deepEqual((await checkWiki(root, ["Home", "_Sidebar"])).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
