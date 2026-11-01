import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetLibrary, assetUsageHasReferences, assetUsageLines, imageSourceLabel } from "../src/components/assets/AssetLibrary";
import { StockArtBrowser } from "../src/components/assets/StockArtBrowser";

test("world image library exposes saved-source filters and upload action", () => {
  const html = renderToStaticMarkup(<AssetLibrary worldId="world-1" />);
  assert.match(html, /All saved/);
  assert.match(html, /Uploaded/);
  assert.match(html, /Stock/);
  assert.match(html, /Upload image/);
  assert.match(html, /Select an image to inspect/);
});

test("stock browser starts with placement recommendations and accessible filters", () => {
  const html = renderToStaticMarkup(<StockArtBrowser worldId="world-1" purpose="body" onUse={() => {}} onBrowseWorldImages={() => {}} />);
  assert.match(html, /Recommended for: Body image/);
  assert.match(html, /Search stock art/);
  assert.match(html, /Filter by collection/);
  assert.match(html, /Filter by subject/);
  assert.match(html, /Loading artwork/);
});

test("source, saved-state, and provenance labels stay distinct", () => {
  assert.equal(imageSourceLabel({ source: "UPLOADED" }), "Uploaded image");
  assert.equal(imageSourceLabel({ source: "STOCK" }), "Stock art");
  assert.equal(imageSourceLabel({ source: "IMPORTED" }), "Imported image");
  assert.equal(imageSourceLabel({ source: "UPLOADED", provenance: [{ catalogEntryId: "moss-gate", catalogVersion: 1, verificationOrigin: "BUNDLED_REVIEW", createdAt: "2026-10-23T00:00:00.000Z" }] }), "Reviewed catalog provenance");
  assert.equal(imageSourceLabel({ source: "IMPORTED", provenance: [{ catalogEntryId: "moss-gate", catalogVersion: 1, verificationOrigin: "IMPORTED_DECLARATION", createdAt: "2026-10-23T00:00:00.000Z" }] }), "Imported provenance — not verified");
  assert.equal(imageSourceLabel({ source: "STOCK", provenance: [{ catalogEntryId: "moss-gate", catalogVersion: 1, verificationOrigin: "PENDING_REVIEW", createdAt: "2026-10-23T00:00:00.000Z" }] }), "Pending human review — not verified");
});

test("asset usage includes every persisted reference type when deciding whether deletion is blocked", () => {
  for (const [field, expected] of [
    ["revisionCount", "2 revision snapshots"],
    ["mapCount", "1 map"],
    ["mapLayerCount", "3 map layers"],
    ["timelineCount", "1 timeline"],
    ["categoryCount", "1 category illustration"],
  ] as const) {
    const usage = { worldCover: false, worldBanner: false, worldBackground: false, categoryCount: 0, articleCount: 0, articles: [], revisionCount: 0, mapCount: 0, mapLayerCount: 0, timelineCount: 0, [field]: field === "revisionCount" ? 2 : field === "mapLayerCount" ? 3 : 1 };
    assert.equal(assetUsageHasReferences(usage), true, field);
    assert(assetUsageLines(usage).includes(expected), field);
  }
  const unused = { worldCover: false, worldBanner: false, worldBackground: false, categoryCount: 0, articleCount: 0, articles: [], revisionCount: 0, mapCount: 0, mapLayerCount: 0, timelineCount: 0 };
  assert.equal(assetUsageHasReferences(unused), false);
  assert.deepEqual(assetUsageLines(unused), ["Not referenced anywhere"]);
});
