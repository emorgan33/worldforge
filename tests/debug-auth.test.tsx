import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { assertIsolatedTestEnvironment } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

test("debug: asset upload auth", { skip: !origin }, async (context) => {
  const db = new PrismaClient();
  const stamp = Date.now();
  const owner = await db.user.create({ data: { name: "Debug", email: `debug3-${stamp}@example.invalid` } });
  context.after(async () => { await db.user.delete({ where: { id: owner.id } }); await db.$disconnect(); });
  
  const world = await db.world.create({ data: { ownerId: owner.id, title: "Debug", slug: `debug3-${stamp}`, isPublic: false } });
  
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await db.authSession.create({ data: { userId: owner.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60000) } });
  
  // Test GET with cookie directly
  const res1 = await fetch(`${origin}/api/worlds`, { 
    headers: { Cookie: `worldforge_session=${token}` }
  });
  assert.equal(res1.status, 200);
  
  // Test POST with JSON
  const res2 = await fetch(`${origin}/api/articles`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Cookie: `worldforge_session=${token}`,
      Origin: origin!,
    },
    body: JSON.stringify({ worldId: world.id, title: "Test" }),
  });
  assert.equal(res2.status, 201);
  if (res2.status !== 201) {
    const text = await res2.text();
    console.log("Response:", text);
  }
});
