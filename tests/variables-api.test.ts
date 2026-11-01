import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { interpolateVariables } from "../src/lib/variable-parser";
import type { VariableCollectionItem } from "../src/types";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("variable writes validate scalar fields, persist raw values and render safely on read", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Variable fixture", email: `variables-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Variables", slug: `variables-${randomUUID()}` } });
  const collection = await db.variableCollection.create({ data: { worldId: world.id, name: "Lore", prefix: "lore" } });
  const owned = await authorFetch(db, owner.id, origin!);
  const write = (method: string, body: Record<string, unknown>) => owned(`${origin}/api/variables`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const rawValue = '<strong onclick="alert(1)">Lore</strong><img src=x onerror=alert(1)><a href="javascript:alert(1)">Link</a>';
  const created = await write("POST", { collectionId: collection.id, key: "world_name", type: "RENDERED_FRAGMENT", value: rawValue });
  assert.equal(created.status, 201, await created.clone().text());
  const variable = await created.json();
  assert.equal(variable.value, rawValue, "stored fragments remain portable and are sanitized at rendering");
  for (const fields of [{ value: null }, { value: 12 }, { value: {} }, { title: [] }, { description: 12 }]) {
    const response = await write("PATCH", { id: variable.id, value: "replacement", ...fields });
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await db.variable.findUniqueOrThrow({ where: { id: variable.id } })).value, rawValue);
  }
  for (const fields of [{ key: 12 }, { value: [] }, { type: "UNKNOWN" }, { title: {} }, { description: false }]) {
    const response = await write("POST", { collectionId: collection.id, key: "bad", value: "bad", ...fields });
    assert.equal(response.status, 400, await response.clone().text());
  }
  const response = await owned(`${origin}/api/variables?worldId=${world.id}`);
  assert.equal(response.status, 200);
  const collections: VariableCollectionItem[] = await response.json();
  assert.equal(interpolateVariables("[lore:world_name]", collections, "text"), "<strong>Lore</strong>Link");
  const updated = await write("PATCH", { id: variable.id, value: "", title: null, description: null });
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal((await updated.json()).value, "", "empty text is a valid edit");
});

test("concurrent variable writes preserve both rows and foreign writes are refused", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "Variable owner", email: `variables-owner-${randomUUID()}@example.invalid` } });
  const foreign = await db.user.create({ data: { name: "Foreign owner", email: `variables-foreign-${randomUUID()}@example.invalid` } });
  context.after(async () => { await deleteTestUsers(db, owner.id, foreign.id); await db.$disconnect(); });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Variables", slug: `variables-${randomUUID()}` } });
  const collection = await db.variableCollection.create({ data: { worldId: world.id, name: "Lore", prefix: "lore" } });
  const a = await db.variable.create({ data: { collectionId: collection.id, key: "a", value: "old A" } });
  const b = await db.variable.create({ data: { collectionId: collection.id, key: "b", value: "old B" } });
  const owned = await authorFetch(db, owner.id, origin!);
  const denied = await authorFetch(db, foreign.id, origin!);
  const init = (id: string, value: string) => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, value }) });
  const responses = await Promise.all([owned(`${origin}/api/variables`, init(a.id, "new A")), owned(`${origin}/api/variables`, init(b.id, "new B"))]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await denied(`${origin}/api/variables`, init(a.id, "takeover"))).status, 404);
  assert.equal((await denied(`${origin}/api/variables`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionId: collection.id, key: "takeover", value: "bad" }) })).status, 404);
  const response = await owned(`${origin}/api/variables?worldId=${world.id}`);
  assert.equal(response.status, 200);
  const collections: VariableCollectionItem[] = await response.json();
  assert.deepEqual(collections[0].variables.map(v => v.value), ["new A", "new B"]);
});
