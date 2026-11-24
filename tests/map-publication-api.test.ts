import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { assetUrl } from "../src/lib/assets";
import { parseMapSnapshot } from "../src/lib/map-publication";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("maps publish an explicit player snapshot and share only its images", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Map publisher", email: `map-publish-${randomUUID()}@example.invalid` } });
  const other = await db.user.create({ data: { name: "Map stranger", email: `map-publish-other-${randomUUID()}@example.invalid` } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } });
    await deleteTestUsers(db, owner.id, other.id);
    await db.$disconnect();
  });

  const owned = await authorFetch(db, owner.id, origin!);
  const foreign = await authorFetch(db, other.id, origin!);
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Published maps", slug: `map-pub-${randomUUID()}` } });
  const asset = await db.imageAsset.create({
    data: {
      worldId: world.id, title: "Coast map", originalName: "coast.webp", byteSize: 128, width: 1920, height: 1080,
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    },
  });
  const map = await db.map.create({
    data: {
      worldId: world.id, title: "Coast", imageUrl: assetUrl(asset.id), width: 1920, height: 1080,
      layers: { create: [{ name: "Public", order: 0 }, { name: "Secrets", order: 1 }] },
    },
    include: { layers: true },
  });
  const [publicLayer, secretLayer] = map.layers;
  const harbor = await db.marker.create({
    data: { mapId: map.id, layerId: publicLayer.id, title: "Harbor", x: 40, y: 55, icon: "flag", color: "#3b82f6" },
  });
  const vault = await db.marker.create({
    data: { mapId: map.id, layerId: secretLayer.id, title: "Hidden vault", x: 10, y: 10, icon: "gem", color: "#ef4444" },
  });
  const label = await db.mapElement.create({
    data: { mapId: map.id, layerId: publicLayer.id, kind: "LABEL", geometry: JSON.stringify({ x: 8, y: 12, text: "North Watch" }), style: JSON.stringify({ color: "#eab308" }), order: 0 },
  });

  const send = (fetcher: typeof owned, body: unknown, method = "POST") =>
    fetcher(`${origin}/api/maps/publish`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const before = await owned(`${origin}/api/maps/publish?worldId=${world.id}&mapId=${map.id}`);
  assert.equal(before.status, 200);
  assert.equal((await before.json()).publishedAt, null);

  const empty = await send(owned, { worldId: world.id, mapId: map.id, layers: [], markers: [], elements: [] });
  assert.equal(empty.status, 400);

  const withoutSharing = await send(owned, {
    worldId: world.id, mapId: map.id,
    layers: [publicLayer.id], markers: [harbor.id], elements: [label.id], shareImages: false,
  });
  assert.equal(withoutSharing.status, 400, "an unshared map image must block publication");
  assert.equal(await db.mapPublication.count({ where: { mapId: map.id } }), 0);

  const published = await send(owned, {
    worldId: world.id, mapId: map.id,
    layers: [publicLayer.id], markers: [harbor.id, vault.id], elements: [label.id], shareImages: true,
  });
  assert.equal(published.status, 201, await published.clone().text());
  const result = await published.json();
  assert.equal(result.summary.markers, 1, "a pin on an unpublished layer is dropped");
  assert.equal(result.summary.layers, 1);
  assert.equal(result.imagesShared, 1);
  const policy = await db.audiencePolicy.findUnique({ where: { resourceKind_resourceId: { resourceKind: "assets", resourceId: asset.id } } });
  assert.equal(policy?.mode, "PUBLIC", "publishing shares the map image with campaign players");

  const stored = await db.mapPublication.findUniqueOrThrow({ where: { mapId: map.id } });
  const snapshot = parseMapSnapshot(stored.snapshot);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.markers.map(marker => marker.title), ["Harbor"]);
  assert.equal(JSON.stringify(snapshot).includes("Hidden vault"), false);

  const republished = await send(owned, {
    worldId: world.id, mapId: map.id,
    layers: [publicLayer.id], markers: [harbor.id], elements: [], shareImages: true,
  });
  assert.equal(republished.status, 201);
  assert.equal((await republished.json()).revision, 2);

  const denied = await send(foreign, {
    worldId: world.id, mapId: map.id, layers: [publicLayer.id], markers: [harbor.id], elements: [],
  });
  assert.equal(denied.status, 404, "another owner cannot publish this map");

  const removed = await send(owned, { worldId: world.id, mapId: map.id }, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal(await db.mapPublication.count({ where: { mapId: map.id } }), 0);
});
