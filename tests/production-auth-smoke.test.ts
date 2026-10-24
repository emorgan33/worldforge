import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment } from "./auth-fixture";
import { hashPassword } from "../src/lib/passwords";
import { SESSION_COOKIE } from "../src/lib/auth-constants";

const origin = process.env.WORLDFORGE_PRODUCTION_TEST_ORIGIN;

test("production login issues a session accepted by authenticated APIs", { skip: !origin }, async context => {
  if (!origin) return;
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const email = `production-auth-${randomUUID()}@example.invalid`;
  const password = "Isolated production smoke passphrase 2046!";
  const user = await db.user.create({
    data: { name: "Production auth smoke", email, passwordHash: await hashPassword(password) },
  });
  context.after(async () => {
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  });

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith(`${SESSION_COOKIE}=`), "login must set the session cookie");
  const cookieHeader = cookie!;

  const session = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookieHeader } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.id, user.id);

  const worlds = await fetch(`${origin}/api/worlds`, { headers: { Cookie: cookieHeader } });
  assert.equal(worlds.status, 200, "the production server must accept its issued session on an authenticated API");
});
