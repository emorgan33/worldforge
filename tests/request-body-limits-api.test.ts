import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("JSON mutation bodies are capped before authorization parses them", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Body limit owner", email: `body-limit-${randomUUID()}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Body limit world", slug: `body-limit-${randomUUID()}` } });
  const collection = await db.variableCollection.create({ data: { worldId: world.id, name: "Limit collection", prefix: "lim" } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id);
    await db.$disconnect();
  });

  const owned = await authorFetch(db, owner.id, origin!);
  const send = (path: string, body: string) => owned(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const oversize = (worldId: string, bytes: number) => JSON.stringify({ worldId, title: "x", padding: "a".repeat(bytes) });

  const article = await send("/api/articles", oversize(world.id, 6 * 1024 * 1024 + 100));
  assert.equal(article.status, 413, await article.clone().text());
  assert.match(article.headers.get("cache-control") ?? "", /no-store/);

  const map = await send("/api/maps", JSON.stringify({ action: "createMap", worldId: world.id, title: "x", imageUrl: "https://example.invalid/map.png", padding: "a".repeat(12 * 1024 * 1024 + 100) }));
  assert.equal(map.status, 413, await map.clone().text());

  const variable = await send("/api/variables", JSON.stringify({ collectionId: collection.id, worldId: world.id, name: "x", padding: "a".repeat(6 * 1024 * 1024 + 100) }));
  assert.equal(variable.status, 413, await variable.clone().text());

  // Chunked requests without Content-Length are capped while streaming.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ worldId: world.id, title: "x", padding: "" })));
      controller.enqueue(new TextEncoder().encode("a".repeat(6 * 1024 * 1024 + 100)));
      controller.close();
    },
  });
  const chunked = await owned(`${origin}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
  assert.equal(chunked.status, 413, await chunked.clone().text());

  // A normal-sized mutation still reaches its handler.
  const normal = await send("/api/articles", JSON.stringify({ worldId: world.id, title: "Small article", template: "GENERIC", contentHtml: "<p>Hello</p>" }));
  assert.notEqual(normal.status, 413, await normal.clone().text());
});
