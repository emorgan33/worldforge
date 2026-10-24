import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacentCreditFor, dedupeCredits, parseCreditSnapshot, type ReaderCredit } from "../src/lib/stock-credits";
import { articleImageAssetIds, articleReferencesAsset } from "../src/lib/asset-references";

const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

function snapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "ship-by-moonlight",
    version: 1,
    collection: "painterly-fantasy",
    title: "Ship by Moonlight",
    attribution: {
      creditText: "Ivan Aivazovsky, Ship by Moonlight, CC0 1.0",
      required: true,
      placement: "adjacent",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      ...overrides,
    },
  });
}

test("parseCreditSnapshot reads title, credit text and placement", () => {
  assert.deepEqual(parseCreditSnapshot(snapshot()), {
    title: "Ship by Moonlight",
    creditText: "Ivan Aivazovsky, Ship by Moonlight, CC0 1.0",
    placement: "adjacent",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    creatorUrl: undefined,
    sourceUrl: undefined,
    modificationNotice: undefined,
  });
});

test("parseCreditSnapshot defaults unknown placement to the credits section", () => {
  assert.equal(parseCreditSnapshot(snapshot({ placement: "somewhere" }))?.placement, "credits-section");
});

test("parseCreditSnapshot rejects malformed, missing and oversized credits", () => {
  assert.equal(parseCreditSnapshot("not json"), null);
  assert.equal(parseCreditSnapshot("null"), null);
  assert.equal(parseCreditSnapshot("[]"), null);
  assert.equal(parseCreditSnapshot(JSON.stringify({ title: "x" })), null);
  assert.equal(parseCreditSnapshot(snapshot({ creditText: "   " })), null);
  assert.equal(parseCreditSnapshot(snapshot({ creditText: "z".repeat(501) })), null);
  assert.equal(parseCreditSnapshot(snapshot({ creditText: 42 })), null);
});

test("parseCreditSnapshot falls back to a neutral title", () => {
  const parsed = parseCreditSnapshot(JSON.stringify({
    attribution: { creditText: "Unknown maker, Public domain", placement: "credits-section" },
  }));
  assert.equal(parsed?.title, "Untitled artwork");
});

function credit(overrides: Partial<ReaderCredit>): ReaderCredit {
  return {
    assetId: ASSET_A,
    title: "Artwork",
    creditText: "Same credit line",
    placement: "credits-section",
    verificationOrigin: "BUNDLED_REVIEW",
    ...overrides,
  };
}

test("dedupeCredits collapses identical credit lines but keeps distinct placements", () => {
  const deduped = dedupeCredits([
    credit({ assetId: ASSET_A }),
    credit({ assetId: ASSET_B }),
    credit({ assetId: ASSET_A, creditText: "A different line" }),
    credit({ assetId: ASSET_A, placement: "adjacent" }),
  ]);
  assert.equal(deduped.length, 3);
  assert.equal(deduped.filter(c => c.creditText === "Same credit line").length, 2);
});

test("adjacentCreditFor only returns adjacent credits for the given asset", () => {
  const credits = [credit({ assetId: ASSET_A, placement: "credits-section" }), credit({ assetId: ASSET_B, placement: "adjacent" })];
  assert.equal(adjacentCreditFor(credits, ASSET_B)?.assetId, ASSET_B);
  assert.equal(adjacentCreditFor(credits, ASSET_A), null);
  assert.equal(adjacentCreditFor(credits, null), null);
});

test("reader credit parsing preserves links and modification notices", () => {
  const parsed = parseCreditSnapshot(snapshot({ sourceUrl: "https://example.com/original", creatorUrl: "https://example.com/artist", modificationNotice: "Cropped and converted to WebP." }));
  assert.equal(parsed?.licenseUrl, "https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(parsed?.sourceUrl, "https://example.com/original");
  assert.equal(parsed?.creatorUrl, "https://example.com/artist");
  assert.equal(parsed?.modificationNotice, "Cropped and converted to WebP.");
});

test("deduplication preserves distinct licenses and modification notices", () => {
  const deduped = dedupeCredits([
    { ...credit({}), licenseUrl: "https://example.com/license-a", modificationNotice: "Cropped." },
    { ...credit({}), licenseUrl: "https://example.com/license-b", modificationNotice: "Cropped." },
    { ...credit({}), licenseUrl: "https://example.com/license-a", modificationNotice: "Recolored." },
  ]);
  assert.equal(deduped.length, 3);
});

test("articleReferencesAsset matches cover, portrait and parsed body images only", () => {
  const base = { id: "a1", title: "Title", slug: "title", category: null };
  const url = `/api/assets/${ASSET_A}/file`;
  assert.equal(articleReferencesAsset({ ...base, coverImage: url, portraitImage: null, contentJson: null, contentHtml: null }, ASSET_A), true);
  assert.equal(articleReferencesAsset({ ...base, coverImage: null, portraitImage: url, contentJson: null, contentHtml: null }, ASSET_A), true);
  assert.equal(
    articleReferencesAsset({ ...base, coverImage: null, portraitImage: null, contentJson: null, contentHtml: `<p><img src="${url}" /></p>` }, ASSET_A),
    true,
  );
  // Prose that merely contains the URL string is not a real image reference.
  assert.equal(
    articleReferencesAsset({ ...base, coverImage: null, portraitImage: null, contentJson: null, contentHtml: `<p>See ${url} for details</p>` }, ASSET_A),
    false,
  );
  assert.equal(articleReferencesAsset({ ...base, coverImage: null, portraitImage: null, contentJson: null, contentHtml: "<p>Nothing here</p>" }, ASSET_A), false);
  assert.equal(articleReferencesAsset({ ...base, coverImage: `/api/assets/${ASSET_B}/file`, portraitImage: null, contentJson: null, contentHtml: null }, ASSET_A), false);
});

test("articleImageAssetIds gathers cover, portrait and body image ids without duplicates", () => {
  const doc = { type: "doc", content: [{ type: "image", attrs: { src: `/api/assets/${ASSET_B}/file` } }, { type: "paragraph", content: [] }] };
  const ids = articleImageAssetIds(doc, `/api/assets/${ASSET_A}/file`, `/api/assets/${ASSET_A}/file`);
  assert.deepEqual(ids, [ASSET_A, ASSET_B]);
  assert.deepEqual(articleImageAssetIds(doc, "https://example.com/remote.png"), [ASSET_B]);
});
