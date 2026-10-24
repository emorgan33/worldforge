import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";
import { removeAssetFile, writeAsset } from "../src/lib/asset-storage";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("reader credits and image authorization follow publication and revocation", { skip: !origin }, async context => {
  assert.match(origin!, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  const db = new PrismaClient();
  const user = await db.user.create({ data: { name: "Reader credits fixture", email: `reader-credits-${Date.now()}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: user.id, title: "Credited world", slug: `credited-${Date.now()}`, isPublic: true } });
  const assetId = randomUUID();
  const assetUrl = `/api/assets/${assetId}/file`;
  context.after(async () => {
    await removeAssetFile(assetId).catch(() => {});
    await db.world.deleteMany({ where: { ownerId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  });
  const owned = await authorFetch(db, user.id, origin!);

  await writeAsset(assetId, Buffer.from("credits-test-image-bytes"));
  await db.imageAsset.create({ data: { id: assetId, worldId: world.id, title: "Ship by Moonlight", originalName: "ship.webp", mimeType: "image/webp", byteSize: 1, width: 100, height: 100, sha256: `credits-${assetId}`, source: "STOCK" } });
  await db.imageAssetProvenance.create({
    data: {
      assetId,
      catalogEntryId: "ship-by-moonlight",
      catalogVersion: 1,
      manifestDigest: "c".repeat(64),
      verificationOrigin: "BUNDLED_REVIEW",
      snapshotJson: JSON.stringify({
        id: "ship-by-moonlight",
        version: 1,
        collection: "painterly-fantasy",
        title: "Ship by Moonlight",
        attribution: { creditText: "Ivan Aivazovsky, Ship by Moonlight, CC0 1.0", required: true, placement: "adjacent", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
      }),
    },
  });

  await db.imageAssetProvenance.create({ data: {
    assetId, catalogEntryId: "alternate-credit", catalogVersion: 1, manifestDigest: "d".repeat(64), verificationOrigin: "IMPORTED_DECLARATION",
    snapshotJson: JSON.stringify({ id: "alternate-credit", version: 1, title: "Alternate credit", attribution: { creditText: "Second creator credit", required: true, placement: "adjacent", licenseUrl: "https://example.com/alternate-license", sourceUrl: "https://example.com/original", creatorUrl: "https://example.com/creator", modificationNotice: "Cropped and converted to WebP." } }),
  } });

  const category = await db.category.create({ data: { worldId: world.id, name: "Harbor", order: 0, iconImage: assetUrl } });

  const created = await owned(`${origin}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worldId: world.id,
      title: "Harbor guide",
      categoryId: category.id,
      coverImage: assetUrl,
      portraitImage: assetUrl,
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      contentHtml: "<p>Harbor lore</p>",
      metadata: { rulesSystem: "DND_5E" },
    }),
  });
  assert.equal(created.status, 201);
  const article = await created.json();

  // Anonymous readers receive the illustration, its credit, and the bytes.
  const publicBody = await (await fetch(`${origin}/w/${world.slug}/a/${article.slug}`)).text();
  assert(publicBody.includes("Ivan Aivazovsky, Ship by Moonlight, CC0 1.0"), "the reader credit renders on the public article");
  assert(publicBody.includes(assetUrl), "the public article renders the credited image");
  for (const value of ["Second creator credit", "Cropped and converted to WebP.", 'href="https://example.com/alternate-license"', 'href="https://example.com/original"', 'href="https://example.com/creator"']) assert(publicBody.includes(value), `reader attribution retains ${value}`);
  assert(publicBody.includes("Artwork credits"));
  assert.equal((await fetch(`${origin}${assetUrl}`)).status, 200, "anonymous readers may fetch a credited portrait/cover");

  // A category illustration on a public world page is also anonymously fetchable.
  const worldBody = await (await fetch(`${origin}/w/${world.slug}`)).text();
  assert(worldBody.includes(assetUrl), "the category illustration appears on the public world page");
  assert(worldBody.includes("Second creator credit"), "category artwork credits appear on the world page");
  assert.equal((await fetch(`${origin}${assetUrl}`)).status, 200);

  // Revocation: taking the article private removes its page, its credit and its
  // placement image. The asset stays public while the category illustration
  // still references it, then stops being served once that reference is gone.
  assert.equal((await owned(`${origin}/api/articles/${article.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: "PRIVATE" }) })).status, 200);
  const revokedArticle = await (await fetch(`${origin}/w/${world.slug}/a/${article.slug}`)).text();
  assert(!revokedArticle.includes("Ivan Aivazovsky, Ship by Moonlight, CC0 1.0"), "the revoked credit no longer renders");
  assert.equal((await fetch(`${origin}${assetUrl}`)).status, 200, "the category illustration still references the asset");
  await db.category.update({ where: { id: category.id }, data: { iconImage: null } });
  assert.equal((await fetch(`${origin}${assetUrl}`)).status, 404, "with no public references the art stops being served to anonymous readers");
  const revokedWorld = await (await fetch(`${origin}/w/${world.slug}`)).text();
  assert(!revokedWorld.includes(assetUrl), "the removed category illustration no longer appears");
});
