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

  // Admin authorization regression: anonymous, non-admin, disabled admin denied; active admin accepted.
  const anonAdminResponse = await fetch(`${origin}/admin/users`, { redirect: "manual" });
  assert.ok([401, 302, 403].includes(anonAdminResponse.status), `anonymous /admin/users must be denied (status ${anonAdminResponse.status})`);

  const anonApiResponse = await fetch(`${origin}/api/admin/users`, { redirect: "manual" });
  assert.equal(anonApiResponse.status, 401, `anonymous /api/admin/users must return 401 (status ${anonApiResponse.status})`);

  // Non-admin (AUTHOR) session denied at /admin/users
  const nonAdminUser = await db.user.create({ data: { name: "Production non-admin", email: `production-nonadmin-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
  const nonAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: nonAdminUser.id, tokenHash: createHash("sha256").update(nonAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  const nonAdminCookieHeader = `${SESSION_COOKIE}=${nonAdminToken}`;
  const nonAdminResponse = await fetch(`${origin}/admin/users`, { headers: { Cookie: nonAdminCookieHeader, Origin: origin }, redirect: "manual" });
  assert.ok([401, 302, 403].includes(nonAdminResponse.status), `non-admin /admin/users must be denied (status ${nonAdminResponse.status})`);
  await db.authSession.deleteMany({ where: { userId: nonAdminUser.id } });
  await deleteTestUsers(db, nonAdminUser.id);

  // Disabled admin denied
  const disabledAdminAccount = await db.user.create({
    data: { name: "Production disabled admin", email: `production-disabled-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: new Date() },
  });
  const disabledAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: disabledAdminAccount.id, tokenHash: createHash("sha256").update(disabledAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const disabledAdminCookieHeader = `${SESSION_COOKIE}=${disabledAdminToken}`;
  const disabledAdminResponse = await fetch(`${origin}/admin/users`, { headers: { Cookie: disabledAdminCookieHeader, Origin: origin }, redirect: "manual" });
  assert.ok([401, 302, 403].includes(disabledAdminResponse.status), `disabled admin /admin/users must be denied (status ${disabledAdminResponse.status})`);

  const disabledAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: disabledAdminCookieHeader, Origin: origin } });
  assert.equal(disabledAdminApiResponse.status, 401, `disabled admin /api/admin/users must return 401 (status ${disabledAdminApiResponse.status})`);
  await db.authSession.deleteMany({ where: { userId: disabledAdminAccount.id } });
  await deleteTestUsers(db, disabledAdminAccount.id);

  // Active admin accepted at /admin/users and /api/admin/users
  const activeAdminAccount = await db.user.create({
    data: { name: "Production active admin", email: `production-active-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: null },
  });
  const activeAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: activeAdminAccount.id, tokenHash: createHash("sha256").update(activeAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const activeAdminCookieHeader = `${SESSION_COOKIE}=${activeAdminToken}`;
  const activeAdminPageResponse = await fetch(`${origin}/admin/users`, { headers: { Cookie: activeAdminCookieHeader, Origin: origin }, redirect: "manual" });
  assert.equal(activeAdminPageResponse.status, 200, `active admin /admin/users must return 200 (status ${activeAdminPageResponse.status})`);

  const activeAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: activeAdminCookieHeader, Origin: origin } });
  assert.equal(activeAdminApiResponse.status, 200, `active admin /api/admin/users must return 200 (status ${activeAdminApiResponse.status})`);
  await db.authSession.deleteMany({ where: { userId: activeAdminAccount.id } });
  await deleteTestUsers(db, activeAdminAccount.id);
});
