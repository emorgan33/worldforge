import assert from "node:assert/strict";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import { createStockArtFixture, digest } from "./stock-art-fixture";
import { stockArtDirectory, validateStockArtCatalog, type StockArtManifestEntry } from "../src/lib/stock-art";

async function validate(root: string) {
  return validateStockArtCatalog({ root });
}

test("a complete reviewed catalog passes and reports a stable manifest digest", async () => {
  const fixture = await createStockArtFixture();
  try {
    const result = await validate(fixture.root);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.errors.length, 0);
    assert.equal(result.manifestDigest, digest(fixture.bytes));
    assert.equal(result.catalog?.entries[0].id, "moss-gate");
    assert.equal(result.warnings.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("the installed candidate catalog validates its bundled images and evidence", async () => {
  const result = await validateStockArtCatalog({ root: stockArtDirectory(), verifyFiles: true });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.catalog && result.catalog.entries.length > 0);
  for (const entry of result.catalog.entries) {
    assert.ok(entry.rights.evidence.reviewer, "candidate review status must be recorded without implying approval");
  }
});

test("an empty catalog remains valid and reports that no artwork is curated", async () => {
  const fixture = await createStockArtFixture();
  try {
    fixture.manifest.entries = [];
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.catalog?.entries.length, 0);
    assert.match(result.warnings.join("\n"), /no artwork is curated yet/);
  } finally {
    await fixture.cleanup();
  }
});

test("missing rights evidence and prohibited distribution uses are rejected", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = fixture.manifest.entries[0] as StockArtManifestEntry;
    entry.rights.licenseUrl = "";
    entry.allowedUses.worldExport = "prohibited";
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, false);
    const errors = result.errors.join("\n");
    assert.match(errors, /rights\.licenseUrl/);
    assert.match(errors, /available entries require every distribution use/);
  } finally {
    await fixture.cleanup();
  }

  const missingEvidence = await createStockArtFixture();
  try {
    const entry = missingEvidence.manifest.entries[0] as StockArtManifestEntry;
    entry.rights.evidence.file = "evidence/missing.txt";
    await missingEvidence.save();
    const result = await validate(missingEvidence.root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /evidence file is missing/);
  } finally {
    await missingEvidence.cleanup();
  }
});

test("file paths stay inside the bundle and checksums must match", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = fixture.manifest.entries[0] as StockArtManifestEntry;
    entry.files.image = "../outside.webp";
    entry.derivatives.thumbnailSha256 = "0".repeat(64);
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, false);
    const errors = result.errors.join("\n");
    assert.match(errors, /keep the image inside the stock-art bundle/);
    assert.match(errors, /thumbnail: checksum does not match/);
  } finally {
    await fixture.cleanup();
  }
});

test("recommended placements require narrow and wide crops and category-size reviews", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = fixture.manifest.entries[0] as StockArtManifestEntry;
    entry.visual.recommendations = [
      { purpose: "body", recommended: true, rationale: "Only one crop was reviewed.", reviewedCrops: [{ width: 320, height: 240, result: "pass" }] },
      { purpose: "category-icon", recommended: true, rationale: "Silhouette holds.", reviewedCrops: [{ width: 32, height: 32, result: "pass" }], categorySizes: [{ size: 16, readable: true }, { size: 24, readable: true }] },
    ];
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, false);
    const errors = result.errors.join("\n");
    assert.match(errors, /review at least narrow and wide crop cases/);
    assert.match(errors, /categorySizes: a 32px review is required/);
  } finally {
    await fixture.cleanup();
  }

  const unreadable = await createStockArtFixture();
  try {
    const entry = unreadable.manifest.entries[0] as StockArtManifestEntry;
    entry.visual.recommendations = [{
      purpose: "category-icon",
      recommended: true,
      rationale: "Silhouette holds.",
      reviewedCrops: [{ width: 32, height: 32, result: "pass" }],
      categorySizes: [{ size: 16, readable: true }, { size: 24, readable: true }, { size: 32, readable: false }],
    }];
    await unreadable.save();
    const result = await validate(unreadable.root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /must be readable at 32px/);
  } finally {
    await unreadable.cleanup();
  }
});

test("duplicate identities and unknown purposes are rejected", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = JSON.parse(JSON.stringify(fixture.manifest.entries[0])) as StockArtManifestEntry;
    entry.visual.recommendations[0].purpose = "hero-banner" as never;
    fixture.manifest.entries.push(entry);
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, false);
    const errors = result.errors.join("\n");
    assert.match(errors, /duplicate catalog identity moss-gate@1/);
    assert.match(errors, /unknown placement purpose/);
  } finally {
    await fixture.cleanup();
  }
});

test("retired entries are not selectable but retain valid provenance", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = fixture.manifest.entries[0] as StockArtManifestEntry;
    entry.lifecycle = { state: "retired", reason: "Superseded by a reviewed replacement.", date: "2026-10-22", replacementEntryId: "moss-gate-2" };
    entry.allowedUses.publicDisplay = "prohibited";
    await fixture.save();
    const result = await validate(fixture.root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /replacementEntryId: reference a different catalog entry/);

    entry.lifecycle = { state: "retired", reason: "Superseded by a reviewed replacement.", date: "2026-10-22" };
    await fixture.save();
    const retired = await validate(fixture.root);
    assert.equal(retired.ok, true, retired.errors.join("\n"));
    assert.equal(retired.catalog?.entries[0].lifecycle.state, "retired");
  } finally {
    await fixture.cleanup();
  }
});

test("validator can skip bundled file checks without dropping metadata validation", async () => {
  const fixture = await createStockArtFixture();
  try {
    const entry = fixture.manifest.entries[0] as StockArtManifestEntry;
    entry.rights.licenseUrl = "";
    await fixture.save();
    await rm(`${fixture.root}/images/moss-gate/1.webp`);
    const result = await validateStockArtCatalog({ root: fixture.root, verifyFiles: false });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /rights\.licenseUrl/);
    assert.doesNotMatch(result.errors.join("\n"), /file is missing/);
  } finally {
    await fixture.cleanup();
  }
});
