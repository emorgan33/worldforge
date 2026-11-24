import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { hashPassword, tokenHash } from "../src/lib/passwords";
import { NOTE_LIMIT } from "../src/lib/player-notes";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("player notes are private, versioned, and keep their text when access changes", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const owner = await db.user.create({ data: { name: "Notebook owner", email: `notebook-owner-${randomUUID()}@example.invalid` } });
  const password = "Isolated notebook passphrase 2046!";
  const playerA = await db.user.create({ data: { name: "Notebook A", email: `notebook-a-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const playerB = await db.user.create({ data: { name: "Notebook B", email: `notebook-b-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  context.after(async () => {
    await db.world.deleteMany({ where: { ownerId: owner.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });

  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Notebook world", slug: `notebook-${stamp}` } });
  await db.worldMember.createMany({ data: [
    { worldId: world.id, userId: playerA.id, role: "PLAYER", status: "ACTIVE" },
    { worldId: world.id, userId: playerB.id, role: "PLAYER", status: "ACTIVE" },
  ] });
  const article = await db.article.create({ data: { worldId: world.id, slug: `clue-${stamp}`, title: "The missing ship" } });
  const privateArticle = await db.article.create({ data: { worldId: world.id, slug: `private-${stamp}`, title: "GM only clue" } });
  await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });

  const login = async (userId: string) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "127.0.0.1" },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const cookieA = await login(playerA.id);
  const cookieB = await login(playerB.id);
  const call = (cookie: string, method: string, body?: unknown) =>
    fetch(`${origin}/api/player/notes`, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin! }, body: body === undefined ? undefined : JSON.stringify(body) });
  const list = async (cookie: string) => {
    const response = await call(cookie, "GET");
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).notes as { id: string; title: string; content: string; version: number; worldId: string | null; worldTitle: string | null; reference: { kind: string; title: string } | null }[];
  };

  assert.deepEqual(await list(cookieA), []);

  const standalone = await call(cookieA, "POST", { title: "Session plan", content: "Ask about the lighthouse." });
  assert.equal(standalone.status, 201, await standalone.clone().text());
  const standaloneNote = (await standalone.json()).note;
  const referenced = await call(cookieA, "POST", { title: "Ship clue", content: "Harbor master knows.", worldId: world.id, resourceKind: "article", resourceId: article.id });
  assert.equal(referenced.status, 201);
  const referencedNote = (await referenced.json()).note;

  assert.equal((await call(cookieA, "POST", { title: "Bad clue", resourceKind: "article", resourceId: privateArticle.id })).status, 400, "unreadable references are rejected");
  assert.equal((await call(cookieA, "POST", { title: "Bad campaign", worldId: randomUUID() })).status, 400, "non-member campaigns are rejected");
  assert.equal((await call(cookieA, "POST", { title: "", content: "empty title" })).status, 400);
  assert.equal((await call(cookieA, "POST", { title: "Too long", content: "x".repeat(20_001) })).status, 400);

  const notes = await list(cookieA);
  assert.equal(notes.length, 2);
  const projected = notes.find(note => note.id === referencedNote.id)!;
  assert.equal(projected.reference?.title, "The missing ship");
  assert.equal(projected.worldTitle, "Notebook world");
  assert.equal(notes.find(note => note.id === standaloneNote.id)?.worldId, null);
  assert.deepEqual(await list(cookieB), [], "notes are private per account");

  // Optimistic versioning reports the current server copy on conflict.
  const update = await call(cookieA, "PATCH", { id: standaloneNote.id, title: "Session plan v2", content: "Bring rope.", version: 1 });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).version, 2);
  const stale = await call(cookieA, "PATCH", { id: standaloneNote.id, title: "Stale", version: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).note.title, "Session plan v2");
  assert.equal((await call(cookieB, "PATCH", { id: standaloneNote.id, title: "Hijack", version: 2 })).status, 404);
  assert.equal((await call(cookieB, "DELETE", { id: standaloneNote.id })).status, 200);
  assert.equal((await list(cookieA)).length, 2, "another player's delete does not remove the note");

  // Standalone notes can change campaign; referenced notes keep their target's campaign.
  assert.equal((await call(cookieA, "PATCH", { id: standaloneNote.id, title: "Session plan v3", content: "Bring rope.", version: 2, worldId: world.id })).status, 200);
  assert.equal((await list(cookieA)).find(note => note.id === standaloneNote.id)?.worldTitle, "Notebook world");
  assert.equal((await call(cookieA, "PATCH", { id: standaloneNote.id, title: "Session plan v4", content: "Bring rope.", version: 3, worldId: null })).status, 200);
  assert.equal((await list(cookieA)).find(note => note.id === standaloneNote.id)?.worldId, null);
  assert.equal((await call(cookieA, "PATCH", { id: referencedNote.id, title: "Ship clue", content: "Harbor master knows.", version: 1, worldId: null })).status, 200);
  assert.equal((await list(cookieA)).find(note => note.id === referencedNote.id)?.worldId, world.id, "a referenced note stays with its reference's campaign");

  // Same-origin and preview protections.
  const foreign = await fetch(`${origin}/api/player/notes`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieA, Origin: "https://evil.invalid" }, body: JSON.stringify({ title: "Nope" }) });
  assert.equal(foreign.status, 403);
  const previewToken = randomBytes(32).toString("base64url");
  await db.previewSession.create({ data: { tokenHash: tokenHash(previewToken), userId: playerA.id, worldId: world.id, expiresAt: new Date(Date.now() + 3_600_000), memberAtGrant: true } });
  assert.equal((await fetch(`${origin}/api/player/notes`, { headers: { Cookie: `wf_preview=${previewToken}` } })).status, 403);
  assert.equal((await fetch(`${origin}/api/player/notes`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `wf_preview=${previewToken}`, Origin: origin! }, body: JSON.stringify({ title: "Preview note" }) })).status, 403);

  // Access changes hide only the reference; the player's writing remains.
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "GM_ONLY" } });
  const hidden = (await list(cookieA)).find(note => note.id === referencedNote.id)!;
  assert.equal(hidden.reference, null);
  assert.equal(hidden.content, "Harbor master knows.");
  await db.audiencePolicy.update({ where: { resourceKind_resourceId: { resourceKind: "articles", resourceId: article.id } }, data: { mode: "PUBLIC" } });
  assert.equal((await list(cookieA)).find(note => note.id === referencedNote.id)?.reference?.title, "The missing ship");

  // Archived campaign: the note survives without a campaign label.
  await db.world.update({ where: { id: world.id }, data: { deletedAt: new Date() } });
  const archived = (await list(cookieA)).find(note => note.id === referencedNote.id)!;
  assert.equal(archived.worldId, null);
  assert.equal(archived.reference, null);
  assert.equal(archived.content, "Harbor master knows.");
  await db.world.update({ where: { id: world.id }, data: { deletedAt: null } });

  // Published maps can be referenced; unpublishing hides the link only.
  const asset = await db.imageAsset.create({
    data: { worldId: world.id, title: "Notebook map", originalName: "notebook.webp", byteSize: 32, width: 1000, height: 600, sha256: stamp.replaceAll("-", "").padEnd(64, "0").slice(0, 64) },
  });
  const map = await db.map.create({ data: { worldId: world.id, title: "Working map", imageUrl: `/api/assets/${asset.id}/file`, width: 1000, height: 600 } });
  const marker = await db.marker.create({ data: { mapId: map.id, title: "Harbor", x: 30, y: 40 } });
  const owned = await authorFetch(db, owner.id, origin!);
  const publish = (method: string, body: object) => owned(`${origin}/api/maps/publish`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await publish("POST", { worldId: world.id, mapId: map.id, layers: [], markers: [marker.id], elements: [], shareImages: true })).status, 201);
  await owned(`${origin}/api/resources/maps/${map.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PUBLIC", userIds: [] }) });

  const mapNote = await call(cookieA, "POST", { title: "Harbor route", content: "Come from the north.", resourceKind: "map", resourceId: map.id });
  assert.equal(mapNote.status, 201, await mapNote.clone().text());
  const mapNoteId = (await mapNote.json()).note.id as string;
  assert.equal((await list(cookieA)).find(note => note.id === mapNoteId)?.reference?.kind, "map");

  await owned(`${origin}/api/resources/assets/${asset.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "GM_ONLY", userIds: [] }) });
  assert.equal((await list(cookieA)).find(note => note.id === mapNoteId)?.reference, null, "an unreadable map image hides only the link");
  assert.equal((await list(cookieA)).find(note => note.id === mapNoteId)?.content, "Come from the north.");
  await owned(`${origin}/api/resources/assets/${asset.id}/audience`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PUBLIC", userIds: [] }) });
  assert.equal((await list(cookieA)).find(note => note.id === mapNoteId)?.reference?.kind, "map");

  assert.equal((await publish("DELETE", { worldId: world.id, mapId: map.id })).status, 200);
  const unpublished = (await list(cookieA)).find(note => note.title === "Harbor route")!;
  assert.equal(unpublished.reference, null);
  assert.equal(unpublished.content, "Come from the north.");

  // Deleting the note itself removes it.
  assert.equal((await call(cookieA, "DELETE", { id: standaloneNote.id })).status, 200);
  assert.equal((await list(cookieA)).some(note => note.id === standaloneNote.id), false);
  assert.equal((await call("", "GET")).status, 401);
});


test("the notebook enforces its note limit", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const password = "Isolated note limit passphrase 2046!";
  const player = await db.user.create({ data: { name: "Note limit player", email: `note-limit-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  context.after(async () => {
    await deleteTestUsers(db, player.id);
    await db.$disconnect();
  });

  await db.playerNote.createMany({
    data: Array.from({ length: NOTE_LIMIT }, (_, index) => ({ userId: player.id, title: `Note ${index}`, content: "" })),
  });
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin!, "X-WorldForge-Client-IP": "127.0.0.1" },
    body: JSON.stringify({ email: player.email, password }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const create = () => fetch(`${origin}/api/player/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin! },
    body: JSON.stringify({ title: "One too many" }),
  });

  const full = await create();
  assert.equal(full.status, 400);
  assert.match((await full.json()).error, /notebook is full/i);
  assert.equal(await db.playerNote.count({ where: { userId: player.id } }), NOTE_LIMIT);

  await db.playerNote.deleteMany({ where: { userId: player.id, title: "Note 0" } });
  assert.equal((await create()).status, 201);

  // Concurrent creates at 499 must not exceed the limit.
  await db.playerNote.deleteMany({ where: { userId: player.id, title: "One too many" } });
  const before = await db.playerNote.count({ where: { userId: player.id } });
  assert.equal(before, NOTE_LIMIT - 1);
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => create()));
  assert.ok(concurrent.filter(response => response.status === 201).length <= 1, "at most one concurrent create may succeed");
  assert.ok(await db.playerNote.count({ where: { userId: player.id } }) <= NOTE_LIMIT, "the limit is never exceeded");
});
