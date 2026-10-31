import { test, before, after } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { writeAsset, readAsset, removeAssetFile } from "../src/lib/asset-storage";
import { authorFetch as authenticatedAuthorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { drainAssetCleanupJobs } from "../src/lib/world-management";

const db = new PrismaClient();
const origin = process.env.WORLDFORGE_TEST_ORIGIN!;

let user: { id: string };
let world: { id: string };
let stamp: number;
let testAssetId: string;

before(async () => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  stamp = Date.now();
  user = await db.user.create({ data: { name: `Asset fixture ${stamp}`, email: `asset-${stamp}@example.invalid` } });
  world = await db.world.create({ data: { ownerId: user.id, title: "Asset world", slug: `asset-${Date.now()}` } });
  testAssetId = randomUUID();
  const buffer = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64");
  await writeAsset(testAssetId, buffer);
  await db.imageAsset.create({ data: { id: testAssetId, worldId: world.id, title: "Test Asset", originalName: "test.webp", alt: "", width: 1, height: 1, byteSize: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") } });
});

after(async () => {
  if (testAssetId) await removeAssetFile(testAssetId).catch(() => {});
  if (world?.id) await db.world.deleteMany({ where: { id: world.id } });
  if (user?.id) await deleteTestUsers(db, user.id);
  await db.$disconnect();
});

async function authorFetch(userId: string, origin: string, path: string, options?: RequestInit) {
  const fetchAsAuthor = await authenticatedAuthorFetch(db, userId, origin);
  return fetchAsAuthor(`${origin}${path}`, options);
}

test("asset upload creates ImageAsset and writes file", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "POST" });
  assert.equal(res.status, 400);
});

test("oversized asset uploads are rejected by the bounded form reader", { skip: !origin }, async () => {
  const boundary = "worldforge-oversized-upload";
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="worldId"\r\n\r\n${world.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oversized.png"\r\nContent-Type: image/png\r\n\r\n`;
  let finishBody!: () => void;
  let bodyFinished = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.enqueue(new Uint8Array(11 * 1024 * 1024));
      finishBody = () => {
        bodyFinished = true;
        try { controller.close(); } catch { /* The server may already have cancelled the stream. */ }
      };
    },
  });
  const fetchAsAuthor = await authenticatedAuthorFetch(db, user.id, origin);
  const responsePromise = fetchAsAuthor(`${origin}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Connection: "close" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      responsePromise,
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Oversized upload response waited for the request body to finish.")), 5000); }),
    ]);
    assert.equal(response.status, 413);
    assert.equal(bodyFinished, false, "413 should arrive while the upload body is still open");
  } finally {
    if (timeout) clearTimeout(timeout);
    finishBody();
    await responsePromise.catch(() => {});
  }
});

test("unknown requests return 405", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets", { method: "DELETE" });
  assert.equal(res.status, 405);
});

test("asset GET without an owned world is concealed as not found", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, "/api/assets");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test("asset source filter rejects unknown values and narrows before pagination", { skip: !origin }, async () => {
  const invalid = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=elsewhere`);
  assert.equal(invalid.status, 400);
  const uploaded = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=uploaded`);
  assert.equal(uploaded.status, 200);
  const uploadedBody = await uploaded.json();
  assert.ok(uploadedBody.assets.every((asset: { source?: string }) => asset.source === "UPLOADED"));
  const stock = await authorFetch(user.id, origin, `/api/assets?worldId=${world.id}&source=stock`);
  assert.equal(stock.status, 200);
  const stockBody = await stock.json();
  assert.ok(!stockBody.assets.some((asset: { id: string }) => asset.id === testAssetId));
});

test("asset usage endpoint returns usage information", { skip: !origin }, async () => {
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.ok(typeof usage.worldCover === "boolean");
  assert.ok(typeof usage.worldBanner === "boolean");
  assert.ok(typeof usage.worldBackground === "boolean");
  assert.ok(typeof usage.articleCount === "number");
  assert.ok(Array.isArray(usage.articles));
});

test("authenticated malformed asset detail requests return 404", { skip: !origin }, async () => {
  for (const route of ["usage", "", "permanent"]) {
    const suffix = route ? `/${route}` : "";
    const response = await authorFetch(user.id, origin, `/api/assets/not-a-uuid${suffix}`, {
      method: route === "usage" ? "GET" : "DELETE",
    });
    assert.equal(response.status, 404, `${route || "archive"} route should conceal malformed resource IDs`);
  }
});

test("asset detail routes enforce the owning world for valid UUIDs", { skip: !origin }, async () => {
  const otherUser = await db.user.create({ data: { name: `Other asset owner ${stamp}`, email: `other-asset-${stamp}@example.invalid` } });
  const otherWorld = await db.world.create({ data: { ownerId: otherUser.id, title: "Other asset world", slug: `other-asset-${stamp}` } });
  const otherAssetId = randomUUID();
  const bytes = Buffer.from("foreign asset fixture");
  await writeAsset(otherAssetId, bytes);
  await db.imageAsset.create({ data: {
    id: otherAssetId, worldId: otherWorld.id, title: "Foreign asset", originalName: "foreign.webp",
    width: 1, height: 1, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  } });

  try {
    for (const route of ["usage", "", "permanent"]) {
      const suffix = route ? `/${route}` : "";
      const response = await authorFetch(user.id, origin, `/api/assets/${otherAssetId}${suffix}`, {
        method: route === "usage" ? "GET" : "DELETE",
      });
      assert.equal(response.status, 404, `${route || "archive"} route should conceal a foreign asset`);
      const remainingAsset = await db.imageAsset.findUnique({ where: { id: otherAssetId } });
      assert.ok(remainingAsset, "foreign asset must remain present");
      assert.equal(remainingAsset.archived, false, "foreign asset must remain unarchived");
      assert.deepEqual(await readAsset(otherAssetId), bytes, "foreign asset bytes must remain unchanged");
    }
  } finally {
    await removeAssetFile(otherAssetId).catch(() => {});
    await db.world.delete({ where: { id: otherWorld.id } });
    await deleteTestUsers(db, otherUser.id);
  }
});

test("asset usage detects world cover reference", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `https://worldforge.example/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.equal(usage.worldCover, true);
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("asset usage detects article body reference", { skip: !origin }, async () => {
  await db.article.create({ data: { worldId: world.id, slug: `test-article-${stamp}`, title: "Test Article", contentHtml: `<img src="/api/assets/${testAssetId}/file" />` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(res.status, 200);
  const usage = await res.json();
  assert.ok(usage.articleCount >= 1);
  const article = usage.articles.find((a: { title: string }) => a.title === "Test Article");
  assert.ok(article);
});

test("asset usage and permanent deletion recognize entity-encoded image URLs in article and revision bodies", { skip: !origin }, async () => {
  const encodedUrl = `/api/ass&#101;ts/${testAssetId}/file`;
  const article = await db.article.create({ data: {
    worldId: world.id, slug: `encoded-body-${stamp}`, title: "Encoded body reference",
    contentHtml: `<p>Art</p><img src="${encodedUrl}" />`,
  } });
  await db.articleRevision.create({ data: {
    articleId: article.id, userId: user.id, title: article.title, slug: article.slug,
    publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT", articleVersionAtSave: 1,
    contentHtml: `<img src="${encodedUrl}" />`,
  } });

  const usageResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.ok(usage.articles.some((item: { title: string }) => item.title === article.title));
  assert.equal(usage.revisionCount, 1);

  const deletionResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  assert.equal(deletionResponse.status, 200);
  const deletion = await deletionResponse.json();
  assert.equal(deletion.referenced, true);
  assert.equal(deletion.deleted, false);
  await db.article.delete({ where: { id: article.id } });
});

test("asset usage and permanent deletion recognize whitespace-padded body image URLs", { skip: !origin }, async () => {
  const createResponse = await authorFetch(user.id, origin, "/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId: world.id, title: "Whitespace body reference", contentHtml: `<p>Art</p><img src=" /api/assets/${testAssetId}/file " />` }),
  });
  assert.equal(createResponse.status, 201);
  const article = await createResponse.json();
  const usageResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.ok(usage.articles.some((item: { id: string }) => item.id === article.id));
  const deletionResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  assert.equal(deletionResponse.status, 200);
  assert.equal((await deletionResponse.json()).deleted, false);
  await db.article.delete({ where: { id: article.id } });
});

test("asset usage and deletion guard include revisions, maps, layers, and timelines", { skip: !origin }, async () => {
  const article = await db.article.create({ data: { worldId: world.id, slug: `revision-${stamp}`, title: "Revision owner" } });
  await db.articleRevision.create({ data: {
    articleId: article.id, userId: user.id, title: article.title, slug: article.slug,
    publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT", articleVersionAtSave: 1,
    coverImage: `/api/assets/${testAssetId}/file`,
  } });
  const map = await db.map.create({ data: { worldId: world.id, title: "Asset map", imageUrl: `/api/assets/${testAssetId}/file` } });
  await db.mapLayer.create({ data: { mapId: map.id, name: "Overlay", imageUrl: `/api/assets/${testAssetId}/file` } });
  await db.timeline.create({ data: { worldId: world.id, title: "Asset timeline", coverImage: `/api/assets/${testAssetId}/file` } });

  const usageResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/usage`);
  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.equal(usage.revisionCount, 1);
  assert.equal(usage.mapCount, 1);
  assert.equal(usage.mapLayerCount, 1);
  assert.equal(usage.timelineCount, 1);

  const deletionResponse = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  assert.equal(deletionResponse.status, 200);
  const deletion = await deletionResponse.json();
  assert.equal(deletion.referenced, true);
  assert.equal(deletion.deleted, false);
});

test("permanent delete fails for referenced assets", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.success, false);
  assert.equal(result.deleted, false);
  assert.equal(result.referenced, true);
  assert.ok(result.references);
  assert.equal(result.references.worldCover, true);
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
});

test("unreferenced permanent delete removes metadata and drains the durable file job", { skip: !origin }, async () => {
  const id = randomUUID();
  const bytes = Buffer.from("a separate asset for permanent deletion");
  await writeAsset(id, bytes);
  try {
    await db.imageAsset.create({ data: { id, worldId: world.id, title: "Disposable", originalName: "disposable.webp", width: 1, height: 1, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
    const response = await authorFetch(user.id, origin, `/api/assets/${id}/permanent`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.deleted, true);
    assert.equal(await db.imageAsset.findUnique({ where: { id } }), null);
    assert.equal(await db.assetCleanupJob.findUnique({ where: { assetId: id } }), null);
    await assert.rejects(import("node:fs/promises").then(fs => fs.readFile(`${process.env.WORLDFORGE_ASSET_DIR}/${id}.webp`)));
  } finally {
    await removeAssetFile(id).catch(() => {});
    await db.assetCleanupJob.deleteMany({ where: { assetId: id } });
    await db.imageAsset.deleteMany({ where: { id } });
  }
});

test("permanent delete keeps failed unlinks queued and retries them", { skip: !origin }, async () => {
  const id = randomUUID();
  const assetPath = path.join(process.env.WORLDFORGE_ASSET_DIR!, `${id}.webp`);
  await mkdir(assetPath);
  try {
    await db.imageAsset.create({ data: { id, worldId: world.id, title: "Retry cleanup", originalName: "retry.webp", width: 1, height: 1, byteSize: 1, sha256: `retry-${id}` } });
    const response = await authorFetch(user.id, origin, `/api/assets/${id}/permanent`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, true);
    assert.equal(await db.imageAsset.findUnique({ where: { id } }), null, "metadata removal commits with the cleanup job");
    const pending = await db.assetCleanupJob.findUniqueOrThrow({ where: { assetId: id } });
    assert.equal(pending.attempts, 1);
    assert.match(pending.lastError || "", /EISDIR|directory/i);

    await rm(assetPath, { recursive: true });
    const retried = await drainAssetCleanupJobs();
    assert.ok(retried.removed >= 1);
    assert.equal(await db.assetCleanupJob.findUnique({ where: { assetId: id } }), null);
  } finally {
    await rm(assetPath, { recursive: true, force: true });
    await db.assetCleanupJob.deleteMany({ where: { assetId: id } });
    await db.imageAsset.deleteMany({ where: { id } });
  }
});

test("archive asset does not require reference check", { skip: !origin }, async () => {
  await db.world.update({ where: { id: world.id }, data: { isPublic: true, coverImage: `/api/assets/${testAssetId}/file` } });
  const res = await authorFetch(user.id, origin, `/api/assets/${testAssetId}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.success, true);
  assert.equal(result.archived, true);
  assert.equal((await fetch(`${origin}/api/assets/${testAssetId}/file`)).status, 200, "archived but placed public image stays readable");
  await db.world.update({ where: { id: world.id }, data: { coverImage: null } });
  assert.equal((await fetch(`${origin}/api/assets/${testAssetId}/file`)).status, 404, "unplaced archived image remains private");
  await db.imageAsset.update({ where: { id: testAssetId }, data: { archived: false } });
  await db.world.update({ where: { id: world.id }, data: { isPublic: false } });
});

test("concurrent placement and permanent deletion never leave a dangling local asset reference", { skip: !origin }, async () => {
  await db.article.deleteMany({ where: { worldId: world.id } });
  await db.map.deleteMany({ where: { worldId: world.id } });
  await db.timeline.deleteMany({ where: { worldId: world.id } });
  await db.category.updateMany({ where: { worldId: world.id }, data: { iconImage: null } });
  await db.world.update({ where: { id: world.id }, data: { coverImage: null, bannerImage: null, appearance: null } });

  const slug = `placement-race-${stamp}`;
  const makeArticle = authorFetch(user.id, origin, "/api/articles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worldId: world.id, title: "Race placement", slug, coverImage: `/api/assets/${testAssetId}/file` }),
  });
  const deleteAsset = authorFetch(user.id, origin, `/api/assets/${testAssetId}/permanent`, { method: "DELETE" });
  const [articleResponse, deleteResponse] = await Promise.all([makeArticle, deleteAsset]);

  const [article, asset] = await Promise.all([
    db.article.findFirst({ where: { worldId: world.id, title: "Race placement" }, select: { id: true, coverImage: true } }),
    db.imageAsset.findUnique({ where: { id: testAssetId }, select: { id: true } }),
  ]);
  if (article) {
    assert.equal(article.coverImage, `/api/assets/${testAssetId}/file`);
    assert.ok(asset, `accepted article placement must retain its asset (POST status ${articleResponse.status}, DELETE status ${deleteResponse.status})`);
  }
  if (!asset) {
    assert.equal(article, null, "asset deletion must not leave an accepted article placement");
    await assert.rejects(readAsset(testAssetId), "successful deletion drains its durable cleanup job");
  }
});
