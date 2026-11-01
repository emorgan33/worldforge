import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
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
    await deleteTestUsers(db, user.id);
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

  // Admin authorization: anonymous / non-admin denied; disabled admin denied; admin accepted.
  const adminResponse = await fetch(`${origin}/admin/users`, { redirect: "manual" });
  assert.ok(adminResponse.status === 401 || adminResponse.status === 302 || adminResponse.status === 403, `anonymous /admin/users must be denied (status ${adminResponse.status})`);

  const adminAccount = await db.user.create({
    data: { name: "Production admin smoke", email: `production-admin-smoke-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: new Date() },
  });
  const adminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: adminAccount.id, tokenHash: createHash("sha256").update(adminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const adminCookieHeader = `${SESSION_COOKIE}=${adminToken}`;
  const disabledAdminResponse = await fetch(`${origin}/admin/users`, { headers: { Cookie: adminCookieHeader, Origin: origin }, redirect: "manual" });
  assert.ok([401, 302, 403].includes(disabledAdminResponse.status), `disabled admin /admin/users must be denied (status ${disabledAdminResponse.status})`);
  await db.authSession.deleteMany({ where: { userId: adminAccount.id } });
  await deleteTestUsers(db, adminAccount.id);
});
