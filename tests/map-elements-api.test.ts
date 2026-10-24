import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

test("map elements validate, persist, update, delete and stay owner-scoped", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Map owner", email: `map-${randomUUID()}@example.invalid` } });
  const other = await db.user.create({ data: { name: "Other owner", email: `map-other-${randomUUID()}@example.invalid` } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await db.$disconnect();
  });

  const owned = await authorFetch(db, owner.id, origin!);
  const foreign = await authorFetch(db, other.id, origin!);
  const send = (fetcher: Fetcher, path: string, body: unknown, method = "POST") =>
    fetcher(`${origin}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Map world", slug: `map-${randomUUID()}` } });

  const mapResponse = await send(owned, "/api/maps", {
    action: "createMap", worldId: world.id, title: "Annotated map", imageUrl: "https://example.invalid/map.png", width: 1200, height: 800,
  });
  assert.equal(mapResponse.status, 201);
  const map = await mapResponse.json();

  const layerResponse = await send(owned, "/api/maps", { action: "createLayer", worldId: world.id, mapId: map.id, name: "Ink" });
  assert.equal(layerResponse.status, 201);
  const layer = await layerResponse.json();

  const otherMapResponse = await send(owned, "/api/maps", {
    action: "createMap", worldId: world.id, title: "Second map", imageUrl: "https://example.invalid/second.png",
  });
  assert.equal(otherMapResponse.status, 201);
  const otherMap = await otherMapResponse.json();
  const otherLayerResponse = await send(owned, "/api/maps", { action: "createLayer", worldId: world.id, mapId: otherMap.id, name: "Other map ink" });
  const otherLayer = await otherLayerResponse.json();

  const cases = [
    { kind: "LABEL", geometry: { x: 12, y: 18, text: "North Watch" }, style: { color: "#eab308", fontSize: 18 } },
    { kind: "LINE", geometry: { x1: 10, y1: 10, x2: 40, y2: 30 }, style: { color: "#ef4444", strokeWidth: 3 } },
    { kind: "CIRCLE", geometry: { x1: 50, y1: 50, x2: 60, y2: 70 }, style: { color: "#3b82f6", strokeWidth: 2 } },
    { kind: "RECT", geometry: { x1: 11, y1: 21, x2: 40, y2: 40 }, style: { color: "#22c55e", strokeWidth: 4 } },
    { kind: "PATH", geometry: { points: [{ x: 10, y: 70 }, { x: 20, y: 80 }, { x: 30, y: 75 }] }, style: { color: "#8b5cf6", strokeWidth: 3 } },
    { kind: "PATH", geometry: { points: [{ x: 60, y: 60 }, { x: 61, y: 61 }] }, style: { erase: true, strokeWidth: 16 } },
  ] as const;

  const created: { id: string; kind: string }[] = [];
  for (const item of cases) {
    const response = await send(owned, "/api/maps", {
      action: "createElement",
      worldId: world.id,
      mapId: map.id,
      kind: item.kind,
      geometry: JSON.stringify(item.geometry),
      style: JSON.stringify(item.style),
      layerId: layer.id,
    });
    assert.equal(response.status, 201, `${item.kind} should be created`);
    const element = await response.json();
    assert.equal(element.kind, item.kind);
    assert.deepEqual(JSON.parse(element.geometry), item.geometry);
    assert.deepEqual(JSON.parse(element.style), item.style);
    assert.equal(element.layerId, layer.id);
    created.push(element);
  }

  const rect = created.find(element => element.kind === "RECT")!;
  const erase = created.filter(element => element.kind === "PATH")[1];

  const badRect = await send(owned, "/api/maps", {
    action: "createElement", worldId: world.id, mapId: map.id, kind: "RECT", geometry: JSON.stringify({ x1: 10, y1: 10, x2: 20 }),
  });
  assert.equal(badRect.status, 400);
  const badKind = await send(owned, "/api/maps", {
    action: "createElement", worldId: world.id, mapId: map.id, kind: "TRIANGLE", geometry: JSON.stringify({ x1: 10, y1: 10 }),
  });
  assert.equal(badKind.status, 400);
  const shortPath = await send(owned, "/api/maps", {
    action: "createElement", worldId: world.id, mapId: map.id, kind: "PATH", geometry: JSON.stringify({ points: [{ x: 1, y: 2 }] }),
  });
  assert.equal(shortPath.status, 400);
  const crossMapLayer = await send(owned, "/api/maps", {
    action: "createElement", worldId: world.id, mapId: map.id, kind: "RECT", geometry: JSON.stringify({ x1: 1, y1: 2, x2: 3, y2: 4 }), layerId: otherLayer.id,
  });
  assert.equal(crossMapLayer.status, 400);

  const updated = await send(owned, "/api/maps", {
    action: "updateElement", worldId: world.id, mapId: map.id, id: rect.id,
    geometry: JSON.stringify({ x1: 15, y1: 25, x2: 55, y2: 65 }), style: JSON.stringify({ color: "#ec4899", strokeWidth: 6 }), layerId: null,
  }, "PATCH");
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json();
  assert.deepEqual(JSON.parse(updatedBody.geometry), { x1: 15, y1: 25, x2: 55, y2: 65 });
  assert.equal(updatedBody.layerId, null);

  const invalidUpdate = await send(owned, "/api/maps", {
    action: "updateElement", worldId: world.id, mapId: map.id, id: rect.id, geometry: JSON.stringify({ x1: 15, y1: 25 }),
  }, "PATCH");
  assert.equal(invalidUpdate.status, 400);
  assert.deepEqual(JSON.parse((await db.mapElement.findUniqueOrThrow({ where: { id: rect.id } })).geometry), { x1: 15, y1: 25, x2: 55, y2: 65 });

  const listResponse = await owned(`${origin}/api/maps?worldId=${world.id}`);
  assert.equal(listResponse.status, 200);
  const maps = await listResponse.json();
  const listed = maps.find((item: { id: string }) => item.id === map.id);
  assert.equal(listed.elements.length, created.length);
  assert.deepEqual(new Set(listed.elements.map((item: { kind: string }) => item.kind)), new Set(["LABEL", "LINE", "CIRCLE", "RECT", "PATH"]));

  const foreignList = await foreign(`${origin}/api/maps?worldId=${world.id}`);
  assert.equal(foreignList.status, 404);
  const foreignCreate = await send(foreign, "/api/maps", {
    action: "createElement", worldId: world.id, mapId: map.id, kind: "LINE", geometry: JSON.stringify({ x1: 1, y1: 2, x2: 3, y2: 4 }),
  });
  assert.equal(foreignCreate.status, 404);
  const foreignUpdate = await send(foreign, "/api/maps", {
    action: "updateElement", worldId: world.id, mapId: map.id, id: rect.id, geometry: JSON.stringify({ x1: 1, y1: 2, x2: 3, y2: 4 }),
  }, "PATCH");
  assert.equal(foreignUpdate.status, 404);

  assert.ok(erase);
  const deleted = await send(owned, "/api/maps", {
    action: "deleteElement", worldId: world.id, mapId: map.id, id: erase.id,
  }, "DELETE");
  assert.equal(deleted.status, 200);
  assert.equal(await db.mapElement.count({ where: { id: erase.id } }), 0);

  const stillLayered = created.find(element => element.kind === "PATH")!;
  const layerDelete = await send(owned, "/api/maps", {
    action: "deleteLayer", worldId: world.id, mapId: map.id, id: layer.id,
  }, "DELETE");
  assert.equal(layerDelete.status, 200);
  assert.equal((await db.mapElement.findUniqueOrThrow({ where: { id: stillLayered.id } })).layerId, null);
});
