import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { authorFetch } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
test("debug: authorFetch works", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Debug2", email: `debug2-${stamp}@example.invalid` } });
  await db.world.create({ data: { ownerId: owner.id, title: "D", slug: `d-${stamp}` } });
  context.after(async () => { await db.user.delete({ where: { id: owner.id } }); await db.$disconnect(); });
  
  const owned = await authorFetch(db, owner.id, origin!);
  const res = await owned(`${origin}/api/worlds`);
  console.log("Status:", res.status);
  assert.equal(res.status, 200);
});
