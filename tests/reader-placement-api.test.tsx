import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import sharp from "sharp";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";
import { writeAsset, removeAssetFile } from "../src/lib/asset-storage";
import { DEFAULT_APPEARANCE } from "../src/lib/world-appearance";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

function descriptions(html: string, url: string) {
  return [...html.matchAll(/<img\b[^>]*>/g)].filter(([tag]) => tag.includes(`src="${url}"`)).map(([tag]) => /alt="([^"]*)"/.exec(tag)?.[1]);
}

async function publicImageFixture(context: TestContext) {
  const db = new PrismaClient();
  const assetIds: string[] = [];
  const ownerIds: string[] = [];
  context.after(async () => {
    try {
      if (ownerIds.length) await db.user.deleteMany({ where: { id: { in: ownerIds } } });
      await Promise.all(assetIds.map(removeAssetFile));
    } finally {
      await db.$disconnect();
    }
  });
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Public image GM", email: `public-images-${stamp}@example.invalid` } });
  ownerIds.push(owner.id);
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Public images", slug: `public-images-${stamp}`, isPublic: true } });
  const owned = await authorFetch(db, owner.id, origin!);
  async function image() {
    const id = randomUUID();
    assetIds.push(id);
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: assetIds.length * 10, g: 80, b: 120, alpha: 1 } } }).webp().toBuffer();
    await writeAsset(id, bytes);
    await db.imageAsset.create({ data: { id, worldId: world.id, title: "Public image fixture", originalName: "fixture.webp", sha256: createHash("sha256").update(bytes).digest("hex"), width: 2, height: 2, byteSize: bytes.length } });
    return { id, url: `/api/assets/${id}/file`, bytes };
  }
  async function article(slug: string, data: Partial<Prisma.ArticleUncheckedCreateInput> = {}) {
    return db.article.create({ data: { worldId: world.id, title: slug, slug, publicationStatus: "PUBLISHED", visibility: "PUBLIC", ...data } });
  }
  async function html(path: string) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    return response.text();
  }
  async function imageResponse(asset: Awaited<ReturnType<typeof image>>, status: number, request = fetch) {
    const response = await request(`${origin}${asset.url}`);
    assert.equal(response.status, status, asset.url);
    if (status === 200) {
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.bytes);
    }
  }
  return { db, world, owner, owned, image, article, html, imageResponse };
}

test("public image bytes match encoded bodies and relative or absolute placements, including archived images", { skip: !origin }, async context => {
  const { db, world, owned, image, article, html, imageResponse } = await publicImageFixture(context);
  const bodyCases = ["entity-html", "escaped-json", "relative-cover", "absolute-cover", "relative-portrait", "absolute-portrait"];
  for (const kind of bodyCases) {
    const asset = await image();
    const src = kind.startsWith("absolute") ? `${origin}${asset.url}` : asset.url;
    const data = kind === "entity-html"
      ? { contentHtml: `<p>Visible body</p><img src="${src.replace("assets", "ass&#101;ts")}" alt="Visible art">` }
      : kind === "escaped-json"
        ? { contentJson: JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src, alt: "Visible art" } }] }).replaceAll("/", "\\u002f"), contentHtml: "<p>Stale HTML without an image</p>" }
        : kind.endsWith("cover") ? { coverImage: src } : { portraitImage: src };
    const placed = await article(kind, data);
    const path = `/w/${world.slug}/a/${placed.slug}`;
    assert(descriptions(await html(path), src).length > 0, `${kind} renders an image`);
    await imageResponse(asset, 200);
    const archive = await owned(`${origin}/api/assets`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: world.id, id: asset.id, archived: true }) });
    assert.equal(archive.status, 200);
    assert(descriptions(await html(path), src).length > 0, `${kind} still renders after archive`);
    await imageResponse(asset, 200);
    await imageResponse(asset, 200, owned);
  }

  const fallback = await article("global-cover-fallback");
  for (const absolute of [false, true]) {
    for (const placement of ["coverImage", "bannerImage", "backgroundImage", "iconImage"]) {
      const asset = await image();
      const src = absolute ? `${origin}${asset.url}` : asset.url;
      if (placement === "iconImage") {
        await db.category.create({ data: { worldId: world.id, name: `Illustrated category ${absolute}`, iconImage: src } });
      } else {
        await db.world.update({ where: { id: world.id }, data: placement === "backgroundImage" ? { appearance: JSON.stringify({ ...DEFAULT_APPEARANCE, backgroundImage: src }) } : { [placement]: src } });
      }
      const path = placement === "bannerImage" ? `/w/${world.slug}/a/${fallback.slug}` : `/w/${world.slug}`;
      assert((await html(path)).includes(src), `${placement} renders (${absolute ? "absolute" : "relative"})`);
      await imageResponse(asset, 200);
      await db.imageAsset.update({ where: { id: asset.id }, data: { archived: true } });
      await imageResponse(asset, 200);
    }
  }
});

test("public image authorization finds a visible placement after more than ten prose and GM-only matches", { skip: !origin }, async context => {
  const { db, world, image, article, html, imageResponse } = await publicImageFixture(context);
  const asset = await image();
  const articleIds = Array.from({ length: 13 }, () => randomUUID()).sort();
  const misleading = [];
  for (let index = 0; index < 12; index++) {
    misleading.push(await article(`misleading-${index}`, { id: articleIds[index], contentHtml: index % 2 ? `<aside class="gm-secret-box"><img src="${asset.url}"></aside>` : `<p>Mention ${asset.url}</p>` }));
  }
  await imageResponse(asset, 404);
  const visible = await article("later-visible", { id: articleIds[12], contentHtml: `<img src="${asset.url}" alt="Visible after misleading matches">` });
  assert(descriptions(await html(`/w/${world.slug}/a/${visible.slug}`), asset.url).length > 0);
  await imageResponse(asset, 200);
  await db.imageAsset.update({ where: { id: asset.id }, data: { archived: true } });
  await imageResponse(asset, 200);
  await db.article.delete({ where: { id: visible.id } });
  await imageResponse(asset, 404);
  assert.equal(await db.article.count({ where: { id: { in: misleading.map(row => row.id) } } }), 12);
});

test("public image authorization excludes private references and revokes on publication and world changes", { skip: !origin }, async context => {
  const { db, world, owner, owned, image, article, html, imageResponse } = await publicImageFixture(context);
  const prose = await image();
  const gmHtml = await image();
  const gmJson = await image();
  const staleHtml = await image();
  const revision = await image();
  const privateCover = await image();
  const draft = await image();
  const map = await image();
  const layer = await image();
  const timeline = await image();
  const unplaced = await image();
  const restricted = await image();
  const publicArticle = await article("denied-images", {
    coverImage: restricted.url,
    contentHtml: `<p>Only prose: ${prose.url}</p><aside class="gm-secret-box"><img src="${gmHtml.url.replace("assets", "ass&#101;ts")}"></aside>`,
  });
  await article("json-denied-images", {
    contentJson: JSON.stringify({ type: "doc", content: [{ type: "campaignCallout", attrs: { kind: "gmNote" }, content: [{ type: "image", attrs: { src: gmJson.url } }] }] }).replaceAll("/", "\\u002f"),
    contentHtml: `<img src="${staleHtml.url}">`,
  });
  await article("private-images", { visibility: "PRIVATE", coverImage: `${origin}${privateCover.url}` });
  await article("draft-images", { publicationStatus: "DRAFT", portraitImage: draft.url });
  await db.articleRevision.create({ data: { articleId: publicArticle.id, userId: owner.id, title: "Old visible version", slug: publicArticle.slug, contentHtml: `<img src="${revision.url}">`, publicationStatus: "PUBLISHED", visibility: "PUBLIC", state: "PUBLISHED", articleVersionAtSave: 1 } });
  await db.map.create({ data: { worldId: world.id, title: "Private map", imageUrl: map.url, layers: { create: { name: "Private layer", imageUrl: layer.url } } } });
  await db.timeline.create({ data: { worldId: world.id, title: "Private timeline", coverImage: timeline.url } });
  await db.imageAsset.update({ where: { id: unplaced.id }, data: { archived: true } });
  await db.imageAsset.update({ where: { id: restricted.id }, data: { displayRestricted: true } });
  const publicHtml = await html(`/w/${world.slug}/a/${publicArticle.slug}`);
  assert.equal(descriptions(publicHtml, prose.url).length, 0);
  for (const asset of [gmHtml, gmJson, staleHtml, revision, privateCover, draft, map, layer, timeline, unplaced, restricted]) {
    assert(!publicHtml.includes(asset.id), `denied image ${asset.id} is absent from reader HTML`);
  }
  const jsonHtml = await html(`/w/${world.slug}/a/json-denied-images`);
  for (const asset of [gmJson, staleHtml]) assert(!jsonHtml.includes(asset.id));
  for (const asset of [prose, gmHtml, gmJson, staleHtml, revision, privateCover, draft, map, layer, timeline, unplaced, restricted]) {
    await imageResponse(asset, 404);
    await imageResponse(asset, 200, owned);
  }

  const shared = await image();
  const placed = await article("revocable", { contentHtml: `<img src="${shared.url.replace("assets", "ass&#101;ts")}">` });
  const path = `/w/${world.slug}/a/${placed.slug}`;
  assert(descriptions(await html(path), shared.url).length > 0);
  await imageResponse(shared, 200);
  await db.article.update({ where: { id: placed.id }, data: { contentHtml: "<p>Placement removed</p>" } });
  assert.equal(descriptions(await html(path), shared.url).length, 0);
  await imageResponse(shared, 404);
  await db.article.update({ where: { id: placed.id }, data: { coverImage: `${origin}${shared.url}` } });
  await imageResponse(shared, 200);
  for (const change of [{ publicationStatus: "DRAFT" }, { visibility: "PRIVATE" }]) {
    await db.article.update({ where: { id: placed.id }, data: change });
    await imageResponse(shared, 404);
    await imageResponse(shared, 200, owned);
    await db.article.update({ where: { id: placed.id }, data: { publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
    await imageResponse(shared, 200);
  }
  await db.world.update({ where: { id: world.id }, data: { isPublic: false } });
  await imageResponse(shared, 404);
  await imageResponse(shared, 200, owned);
  await db.world.update({ where: { id: world.id }, data: { isPublic: true } });
  await imageResponse(shared, 200);
  await db.world.update({ where: { id: world.id }, data: { deletedAt: new Date() } });
  await imageResponse(shared, 404);
  await imageResponse(shared, 404, owned);
});

test("public and campaign readers preserve informative, decorative and fallback descriptions", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const stamp = randomUUID();
  const owner = await db.user.create({ data: { name: "Placement GM", email: `placement-gm-${stamp}@example.invalid` } });
  const player = await db.user.create({ data: { name: "Placement player", email: `placement-player-${stamp}@example.invalid`, role: "PLAYER" } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "World title fallback", slug: `placement-${stamp}`, isPublic: true } });
  const ids = [randomUUID(), randomUUID()];
  const [cover, portrait] = ids.map(id => `/api/assets/${id}/file`);
  context.after(async () => {
    await db.world.deleteMany({ where: { id: world.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, player.id] } } });
    await Promise.all(ids.map(removeAssetFile));
    await db.$disconnect();
  });
  for (const id of ids) {
    await writeAsset(id, Buffer.from("placement-test-image"));
    await db.imageAsset.create({ data: { id, worldId: world.id, title: "Library metadata", alt: "Library default must not replace placement alt", originalName: "fixture.webp", sha256: id, width: 1, height: 1, byteSize: 1 } });
  }
  await db.world.update({ where: { id: world.id }, data: { coverImage: cover, coverImageAlt: "World cover description", bannerImage: cover, bannerImageAlt: "Global cover description" } });
  const article = await db.article.create({ data: { worldId: world.id, title: "Article title fallback", slug: "article", publicationStatus: "PUBLISHED", visibility: "PUBLIC", coverImage: cover, coverImageAlt: "Article cover description", portraitImage: portrait, portraitImageAlt: "Portrait description" } });
  await db.worldMember.create({ data: { worldId: world.id, userId: player.id, status: "ACTIVE" } });
  for (const [kind, id] of [["articles", article.id], ["assets", ids[0]], ["assets", ids[1]]]) {
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: kind, resourceId: id, mode: "PLAYER_SNAPSHOT", grants: { create: { userId: player.id } } } });
  }
  const playerFetch = await authorFetch(db, player.id, origin!);
  const readers = [
    { prefix: "w", request: fetch },
    { prefix: "c", request: playerFetch },
  ];
  for (const reader of readers) {
    const worldHtml = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}`)).text();
    assert(descriptions(worldHtml, cover).includes("World cover description"));
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes("Article cover description"));
    assert(descriptions(html, portrait).includes("Portrait description"));
  }
  await db.article.update({ where: { id: article.id }, data: { coverImageAlt: "", portraitImageAlt: null } });
  await db.world.update({ where: { id: world.id }, data: { coverImageAlt: null } });
  for (const reader of readers) {
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes(""));
    assert(descriptions(html, portrait).includes(article.title));
    const home = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}`)).text();
    assert(descriptions(home, cover).includes(world.title));
  }
  await db.article.update({ where: { id: article.id }, data: { coverImage: null, coverImageAlt: "Stale article description", portraitImageAlt: "" } });
  for (const reader of readers) {
    const html = await (await reader.request(`${origin}/${reader.prefix}/${world.slug}/a/article`)).text();
    assert(descriptions(html, cover).includes("Global cover description"));
    assert(!descriptions(html, cover).includes("Stale article description"));
    assert(descriptions(html, portrait).includes(""));
  }
  await db.audienceGrant.updateMany({ where: { policy: { resourceKind: "assets", resourceId: ids[1] }, userId: player.id }, data: { revokedAt: new Date() } });
  const revoked = await (await playerFetch(`${origin}/c/${world.slug}/a/article`)).text();
  assert.equal(descriptions(revoked, portrait).length, 0);
});
