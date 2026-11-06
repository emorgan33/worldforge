import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
// This job-level expression uses the JS-compatible subset of Actions syntax.
// Exercise the expression in the actual workflow rather than a copied policy.
const condition = workflow.match(/^    if: (.+)$/m)?.[1];
assert.ok(condition);

test("release workflow subscribes to both publication and stable promotion", () => {
  assert.match(workflow, /types: \[published, released\]/);
});

for (const [description, eventName, action, prerelease, expected] of [
  ["ordinary stable publication defers to released", "release", "published", false, false],
  ["ordinary stable release runs once", "release", "released", false, true],
  ["prerelease publication runs (including from draft)", "release", "published", true, true],
  ["stable promotion runs", "release", "released", false, true],
  ["prerelease does not run released", "release", "released", true, false],
  ["packaging pull requests build without publication", "pull_request", "opened", false, true],
] as const) {
  test(description, () => {
    const github = { event_name: eventName, event: { action, release: { prerelease } } };
    assert.equal(runInNewContext(condition, { github }, { timeout: 1000 }), expected);
  });
}
