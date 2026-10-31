import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { characterRowsKey } from "../src/lib/character-sheet";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("character sheets persist through edits, revisions and world export/import without losing lore or profile data", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Sheet owner", email: `sheet-${randomUUID()}@example.invalid` } });
  const foreign = await db.user.create({ data: { name: "Other owner", email: `sheet-other-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id, foreign.id); await db.$disconnect(); });
  const owned = await authorFetch(db, owner.id, origin!);
  const other = await authorFetch(db, foreign.id, origin!);
  const send = (path: string, body: unknown, method = "POST") => owned(`${origin}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const system of ["DND_5E", "PF_2E"] as const) {
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Sheet world", slug: `sheet-${randomUUID()}`, system, isPublic: true } });
    const key = characterRowsKey(system);
    const metadata = {
      rulesSystem: system, species: "Elf", dnd5eClass: "Wizard", pf2eClass: "Bard", dnd5eCurrentHp: "0", pf2eSTR: "-1", customNote: "retain-unshared-note",
      [key]: JSON.stringify({ version: 1, sections: {
        attacks: [{ id: "a", name: "Moonblade", bonus: "+5", secretExtension: "retain-private-extension" }],
        spells: [{ id: "s", name: "Glow", prepared: "true" }], equipment: [{ id: "e", name: "Rope", quantity: "2" }],
      } }),
    };
    const createdResponse = await send("/api/articles", { worldId: world.id, template: "CHARACTER", title: "Sheet fixture", contentHtml: "<p>Original character lore</p>", metadata, publicationStatus: "PUBLISHED", visibility: "PUBLIC" });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal((await send("/api/articles", { worldId: world.id, template: "CHARACTER", title: "Invalid sheet", metadata: { [key]: "invalid" } })).status, 400);
    const read = () => owned(`${origin}/api/articles/${created.id}`).then(response => response.json());
    assert.deepEqual(JSON.parse((await read()).metadata), metadata);
    assert.equal((await other(`${origin}/api/articles/${created.id}`)).status, 404);
    const changed = { ...metadata, [key]: JSON.stringify({ version: 1, sections: { attacks: [], resources: [{ id: "r", name: "Charges", current: "0", maximum: "3" }] } }) };
    assert.equal((await send(`/api/articles/${created.id}`, { metadata: changed }, "PATCH")).status, 200);
    assert.equal((await read()).contentHtml, "<p>Original character lore</p>");
    assert.deepEqual(JSON.parse((await read()).metadata), changed);
    assert.equal((await send(`/api/articles/${created.id}`, { metadata: { ...changed, [key]: '{"version":2}' } }, "PATCH")).status, 400);
    assert.deepEqual(JSON.parse((await read()).metadata), changed);
    const revision = await db.articleRevision.findFirstOrThrow({ where: { articleId: created.id, metadata: JSON.stringify(metadata) } });
    assert.equal((await send(`/api/articles/${created.id}/revisions`, { revisionId: revision.id })).status, 200);
    assert.deepEqual(JSON.parse((await read()).metadata), metadata);

    const reader = await fetch(`${origin}/w/${world.slug}/a/${created.slug}`);
    assert.equal(reader.status, 200);
    const html = await reader.text();
    assert.match(html, /Character sheet/);
    assert.match(html, /Moonblade/);
    assert.match(html, /Original character lore/);
    assert.doesNotMatch(html, /retain-unshared-note|retain-private-extension/);

    const campaignReader = await owned(`${origin}/c/${world.slug}/a/${created.slug}`);
    assert.equal(campaignReader.status, 200);
    const campaignHtml = await campaignReader.text();
    assert.match(campaignHtml, /Character sheet/);
    assert.match(campaignHtml, /Moonblade/);
    assert.doesNotMatch(campaignHtml, /retain-unshared-note|retain-private-extension/);

    const exported = await owned(`${origin}/api/worlds/${world.id}/export?format=v3`);
    assert.equal(exported.status, 200);
    const bundle = await exported.json();
    assert.deepEqual(JSON.parse(bundle.articles.find((article: { id: string }) => article.id === created.id).metadata), metadata);
    const importedResponse = await send("/api/worlds/import", bundle);
    assert.equal(importedResponse.status, 200);
    const imported = await importedResponse.json();
    const importedArticle = await db.article.findFirstOrThrow({ where: { worldId: imported.worldId, title: "Sheet fixture" } });
    assert.deepEqual(JSON.parse(importedArticle.metadata!), metadata);
    assert.equal(importedArticle.contentHtml, "<p>Original character lore</p>");
  }
});
