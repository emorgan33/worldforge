import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { authorFetch, assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("world collection API validates creation, authorizes PATCH targets, and returns explicit summaries", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "World API owner", email: `world-api-${randomUUID()}@example.invalid` } });
  const otherOwner = await db.user.create({ data: { name: "World API other", email: `world-api-other-${randomUUID()}@example.invalid` } });
  const foreign = await db.world.create({ data: { ownerId: otherOwner.id, title: "Foreign", slug: `foreign-${randomUUID()}` } });
  context.after(async () => { await db.user.deleteMany({ where: { id: { in: [owner.id, otherOwner.id] } } }); await db.$disconnect(); });
  const owned = await authorFetch(db, owner.id, origin!);
  const requestId = randomUUID();
  const send = (payload: unknown, fetcher = owned) => fetcher(`${origin}/api/worlds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal((await fetch(`${origin}/api/worlds`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin! }, body: "{}" })).status, 401);
  assert.equal((await owned(`${origin}/api/worlds`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" }, body: "{}" })).status, 403);
  for (const invalid of [
    { title: "x", system: "DND_5E_2024", requestId },
    { title: "x", system: "DND_5E", requestId: "bad" },
    { title: "x", system: "DND_5E", requestId, ownerId: owner.id },
    { title: "x", system: "DND_5E", requestId, isPublic: true },
  ]) assert.equal((await send(invalid)).status, 400);
  assert.equal((await owned(`${origin}/api/worlds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: `{"title":"${"x".repeat(65 * 1024)}"}` })).status, 413);
  const payload = { title: "The Ashen Coast", description: "A shore", system: "PF_2E", requestId };
  const createdResponse = await send(payload);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.isPublic, false);
  assert.equal(created.categories.length, 0);
  assert.deepEqual(created._count, { articles: 0, maps: 0, timelines: 0, secrets: 0, variableCollections: 0 });
  assert.equal("creationRequestId" in created, false);
  assert.equal("creationPayloadHash" in created, false);
  assert.equal("ownerId" in created, false);
  assert.equal((await send(payload)).status, 200);
  assert.equal((await send({ ...payload, title: "Altered" })).status, 409);
  assert.equal((await (await owned(`${origin}/api/worlds`)).json()).some((world: { id: string }) => world.id === created.id), true);

  // Both world settings and campaign rules selection use collection PATCH with body.id.
  const patchBody = { id: created.id, title: "Renamed coast", description: "", coverImage: "", bannerImage: "", system: "DND_5E" };
  const settingsPatch = await owned(`${origin}/api/worlds`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patchBody) });
  assert.equal(settingsPatch.status, 200);
  assert.equal("creationPayloadHash" in await settingsPatch.json(), false);
  const rulesSelectionPatch = await owned(`${origin}/api/worlds`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patchBody, system: "PF_2E" }) });
  assert.equal(rulesSelectionPatch.status, 200);
  assert.equal((await owned(`${origin}/api/worlds`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patchBody, id: foreign.id }) })).status, 404);
  assert.equal((await owned(`${origin}/api/worlds/${foreign.id}/members`, { method: "GET" })).status, 404);
});
