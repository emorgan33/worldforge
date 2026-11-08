import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
// This job-level expression uses the JS-compatible subset of Actions syntax.
// Exercise the expression in the actual workflow rather than a copied policy.
const condition = workflow.match(/^    if: (.+)$/m)?.[1];
assert.ok(condition);
const publishJob = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  tag:"));
const tagJob = workflow.slice(workflow.indexOf("  tag:"));

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
  ["scheduled builds scan without publication", "schedule", "", false, true],
  ["manual builds scan without publication", "workflow_dispatch", "", false, true],
] as const) {
  test(description, () => {
    const github = { event_name: eventName, event: { action, release: { prerelease } } };
    assert.equal(runInNewContext(condition, { github }, { timeout: 1000 }), expected);
  });
}

test("release preflight resolves the complete multi-platform index", () => {
  assert.match(workflow, /name: Resolve release mode/);
  assert.match(workflow, /scripts\/check-release-index\.mjs/);
  assert.match(workflow, /--platforms "linux\/amd64,linux\/arm64"/);
  assert.match(workflow, /status: \$\{\{ steps\.release\.outputs\.status \}\}/);
});

test("verification runs natively on both architectures", () => {
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(workflow, /runner: ubuntu-latest/);
  assert.match(workflow, /runner: ubuntu-24\.04-arm/);
  assert.match(workflow, /platform: linux\/amd64/);
  assert.match(workflow, /platform: linux\/arm64/);
  assert.match(workflow, /WORLDFORGE_EXPECTED_ARCH: \$\{\{ matrix\.architecture \}\}/);
  assert.match(workflow, /docker build --pull --platform "\$PLATFORM"/);
});

test("existing child images are reused by validated digest", () => {
  assert.match(workflow, /EXISTING_DIGEST:[\s\S]*linux_amd64_digest[\s\S]*linux_arm64_digest/);
  assert.match(workflow, /docker pull "\$IMAGE@\$EXISTING_DIGEST"/);
  assert.doesNotMatch(workflow, /docker pull "\$IMAGE:\$VERSION"/);
});

test("matrix verification never publishes or uses registry credentials", () => {
  const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  publish:"));
  assert.doesNotMatch(verifyJob, /docker push/);
  assert.doesNotMatch(verifyJob, /docker login/);
  assert.doesNotMatch(verifyJob, /DOCKERHUB_/);
  assert.doesNotMatch(verifyJob, /gh release edit/);
  assert.doesNotMatch(verifyJob, /imagetools create/);
});

test("both platform results and reports are retained for publication", () => {
  assert.match(workflow, /needs: preflight/);
  assert.match(workflow, /name: worldforge-image-\$\{\{ matrix\.architecture \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /name: image-security-\$\{\{ matrix\.architecture \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /scripts\/release-artifact\.mjs write/);
  assert.match(workflow, /scripts\/release-artifact\.mjs verify/);
});

test("publication is release-only and gated on both platform jobs", () => {

  assert.match(publishJob, /needs: \[preflight, verify\]/);
  assert.match(publishJob, /if: github\.event_name == 'release'/);
  assert.match(publishJob, /actions\/download-artifact@v7/);
  assert.match(publishJob, /worldforge-image-\*-/);
  assert.match(publishJob, /worldforge-published-/);
});

test("publication revalidates archives and pushes only run-scoped staging tags", () => {

  assert.doesNotMatch(publishJob, /docker build/);
  assert.match(publishJob, /scripts\/release-artifact\.mjs verify/);
  assert.match(publishJob, /docker load -i "\$archive"/);
  assert.match(publishJob, /staging-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}-\$\{architecture\}/);
  assert.match(publishJob, /docker push "\$IMAGE:\$staging_tag"/);
  assert.match(publishJob, /scripts\/release-publish\.mjs write/);
  assert.doesNotMatch(publishJob, /"\$IMAGE:\$VERSION"/);
  assert.doesNotMatch(publishJob, /"\$IMAGE:sha-/);
  assert.doesNotMatch(publishJob, /"\$IMAGE:latest"/);
});

test("publication binds loaded content to the tested artifact and platform", () => {

  assert.match(publishJob, /docker load -i "\$archive"/);
  assert.match(publishJob, /image_id=\$\(docker image inspect worldforge-release:test --format '\{\{\.Id\}\}'\)/);
  assert.match(publishJob, /source_digest=[\s\S]*sourceDigest/);
  assert.match(publishJob, /\[\[ "\$source_digest" == "\$child_digest" \]\]/);
  assert.match(publishJob, /\[\[ "\$source_digest" == "\$image_id" \]\]/);
  assert.match(publishJob, /\[\[ "\$image_arch" == "\$architecture" \]\]/);
  assert.match(publishJob, /\[\[ "\$image_revision" == "\$REVISION" \]\]/);
});

test("unchanged releases reuse validated children without pushing", () => {

  assert.match(publishJob, /if \[\[ "\$RELEASE_STATUS" == "existing" \]\]/);
  assert.match(publishJob, /child_digest="\$AMD64_DIGEST"/);
  assert.match(publishJob, /child_digest="\$ARM64_DIGEST"/);
  assert.match(publishJob, /source=existing/);
});

test("registry credentials appear only in release publication jobs", () => {
  const beforePublish = workflow.slice(0, workflow.indexOf("  publish:"));
  assert.doesNotMatch(beforePublish, /DOCKERHUB_/);
  assert.doesNotMatch(beforePublish, /docker login/);
  assert.match(publishJob, /docker login/);
  assert.match(tagJob, /docker login/);
  assert.match(tagJob, /DOCKERHUB_USERNAME/);
  assert.match(tagJob, /DOCKERHUB_TOKEN/);
});

test("release index publication is release-only and gated on child publication", () => {
  assert.match(tagJob, /needs: \[preflight, publish\]/);
  assert.match(tagJob, /if: github\.event_name == 'release'/);
  assert.match(tagJob, /worldforge-published-/);
  assert.match(tagJob, /scripts\/release-publish\.mjs verify/);
  assert.match(tagJob, /scripts\/release-publish\.mjs child/);
  assert.match(tagJob, /AMD64_CHILD=\$amd64_child/);
  assert.match(tagJob, /docker buildx imagetools inspect "\$IMAGE@\$digest"/);
  assert.match(tagJob, /staging-index-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(tagJob, /scripts\/release-index\.mjs plan/);
  assert.match(tagJob, /scripts\/release-index\.mjs verify/);
  assert.match(tagJob, /scripts\/release-index\.mjs write/);
  assert.match(tagJob, /docker buildx imagetools create -t "\$IMAGE:\$tag" "\$IMAGE@\$INDEX_DIGEST"/);
  assert.doesNotMatch(tagJob, /"\$IMAGE:latest"/);
  assert.doesNotMatch(tagJob, /gh release edit/);
});

test("immutable tag publication is idempotent and conflict-safe", () => {
  assert.match(tagJob, /--target "\$VERSION=\$version_existing"/);
  assert.match(tagJob, /--target "sha-\$REVISION=\$sha_existing"/);
  assert.match(tagJob, /--target "\$VERSION=\$version_after"/);
  assert.match(tagJob, /--target "sha-\$REVISION=\$sha_after"/);
  assert.match(tagJob, /check-release-index\.mjs/);
  assert.match(tagJob, /--platforms "linux\/amd64,linux\/arm64" > \/dev\/null/);
  assert.doesNotMatch(tagJob, /docker push/);
});
