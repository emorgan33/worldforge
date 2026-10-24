import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { StockArtManifestEntry } from "../src/lib/stock-art";

export interface StockArtFixtureManifest {
  schemaVersion: 1;
  catalogRevision: string;
  collections: { id: string; title: string; brief: string }[];
  entries: StockArtManifestEntry[];
}

export function digest(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createStockArtFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "worldforge-stock-art-"));
  await mkdir(path.join(root, "images", "moss-gate"), { recursive: true });
  await mkdir(path.join(root, "evidence"), { recursive: true });
  const image = await sharp({ create: { width: 160, height: 120, channels: 4, background: { r: 60, g: 90, b: 70, alpha: 1 } } }).webp().toBuffer();
  const thumbnail = await sharp({ create: { width: 48, height: 36, channels: 4, background: { r: 60, g: 90, b: 70, alpha: 1 } } }).webp().toBuffer();
  const evidence = Buffer.from("CC0 review excerpt for the fixture artwork.");
  await writeFile(path.join(root, "images", "moss-gate", "1.webp"), image);
  await writeFile(path.join(root, "images", "moss-gate", "1.thumb.webp"), thumbnail);
  await writeFile(path.join(root, "evidence", "moss-gate-cc0.txt"), evidence);
  const entry: StockArtManifestEntry = {
    id: "moss-gate",
    version: 1,
    collection: "painterly-fantasy",
    title: "Moss gate",
    subjectTypes: ["location"],
    styleTags: ["painterly", "ruins"],
    searchTerms: ["gate", "moss", "forest"],
    defaultAlt: "A moss-covered stone gate in a dim forest.",
    visual: {
      contactSheet: "docs/stock-art-review/contact-sheet.md",
      coverageSheet: "docs/stock-art-review/coverage-sheet.md",
      recommendations: [
        {
          purpose: "body",
          recommended: true,
          rationale: "The gate remains centered and legible in both tested crops.",
          reviewedCrops: [
            { width: 320, height: 240, result: "pass" },
            { width: 320, height: 480, result: "pass" },
          ],
        },
      ],
    },
    creator: { name: "Fixture Artist", url: "https://example.com/creator" },
    source: { itemUrl: "https://example.com/art/moss-gate", originalFilename: "moss-gate.png", acquiredAt: "2026-10-20" },
    rights: {
      reviewStatus: "approved",
      licenseId: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      evidence: { id: "fixture-evidence", file: "evidence/moss-gate-cc0.txt", sha256: digest(evidence), reviewer: "Fixture Reviewer", reviewedAt: "2026-10-21" },
    },
    allowedUses: {
      applicationBundling: "allowed",
      standaloneRedistribution: "allowed",
      worldExport: "allowed",
      modification: "allowed",
      publicDisplay: "allowed",
    },
    attribution: {
      creditText: "Fixture Artist, CC0 1.0",
      required: false,
      placement: "credits-section",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    files: { image: "images/moss-gate/1.webp", thumbnail: "images/moss-gate/1.thumb.webp" },
    derivatives: {
      originalSha256: digest("original"),
      imageSha256: digest(image),
      thumbnailSha256: digest(thumbnail),
      width: 160,
      height: 120,
      byteSize: image.length,
      thumbnail: { width: 48, height: 36, byteSize: thumbnail.length },
      normalizationRecipe: "sharp rotate, strip metadata, WebP quality 88",
      modifications: ["Normalized to WebP", "Generated 48px thumbnail"],
    },
    lifecycle: { state: "available" },
  };
  const manifest: StockArtFixtureManifest = {
    schemaVersion: 1,
    catalogRevision: "fixture-1",
    collections: [{ id: "painterly-fantasy", title: "Painterly fantasy", brief: "A coherent fixture collection." }],
    entries: [entry],
  };
  const save = async () => {
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
    await writeFile(path.join(root, "manifest.json"), bytes);
    return bytes;
  };
  const bytes = await save();
  const cleanup = () => rm(root, { recursive: true, force: true });
  return { root, image, thumbnail, manifest, entry, bytes, save, cleanup };
}
