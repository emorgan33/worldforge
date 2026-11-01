import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { chromium } from "@playwright/test";
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
  const fixtureUserIds = [user.id];
  context.after(async () => {
    for (const userId of fixtureUserIds) await deleteTestUsers(db, userId);
    await db.$disconnect();
  });

  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-WorldForge-Client-IP": "127.0.0.1" },
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

  // Pages use streamed Next redirects, which can have HTTP 200 while the
  // browser navigates to the destination. Assert the user-visible result.
  const browser = await chromium.launch({ headless: true });
  context.after(async () => browser.close());
  const anonPage = await browser.newPage();
  await anonPage.goto(`${origin}/admin/users`);
  await anonPage.waitForURL(/\/login(?:\?|$)/);
  assert.match(await anonPage.locator("body").innerText(), /sign in|log in|email/i);

  const anonApiResponse = await fetch(`${origin}/api/admin/users`, { redirect: "manual" });
  assert.equal(anonApiResponse.status, 401, `anonymous /api/admin/users must return 401 (status ${anonApiResponse.status})`);

  // Non-admin (AUTHOR) session denied at /admin/users
  const nonAdminUser = await db.user.create({ data: { name: "Production non-admin", email: `production-nonadmin-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
  fixtureUserIds.push(nonAdminUser.id);
  const nonAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: nonAdminUser.id, tokenHash: createHash("sha256").update(nonAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  const nonAdminCookieHeader = `${SESSION_COOKIE}=${nonAdminToken}`;
  const nonAdminPage = await browser.newPage();
  await nonAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: nonAdminToken, url: origin }]);
  await nonAdminPage.goto(`${origin}/admin/users`);
  await nonAdminPage.getByRole("heading", { name: "Administrator access required" }).waitFor();
  assert.match(await nonAdminPage.locator("body").innerText(), /does not have installation administration rights/i);
  const nonAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: nonAdminCookieHeader } });
  assert.equal(nonAdminApiResponse.status, 403, `non-admin /api/admin/users must return 403 (status ${nonAdminApiResponse.status})`);

  // Disabled admin denied
  const disabledAdminAccount = await db.user.create({
    data: { name: "Production disabled admin", email: `production-disabled-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: new Date() },
  });
  fixtureUserIds.push(disabledAdminAccount.id);
  const disabledAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: disabledAdminAccount.id, tokenHash: createHash("sha256").update(disabledAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const disabledAdminCookieHeader = `${SESSION_COOKIE}=${disabledAdminToken}`;
  const disabledAdminPage = await browser.newPage();
  await disabledAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: disabledAdminToken, url: origin }]);
  await disabledAdminPage.goto(`${origin}/admin/users`);
  await disabledAdminPage.waitForURL(/\/login(?:\?|$)/);
  assert.match(await disabledAdminPage.locator("body").innerText(), /sign in|log in|email/i);

  const disabledAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: disabledAdminCookieHeader, Origin: origin } });
  assert.equal(disabledAdminApiResponse.status, 401, `disabled admin /api/admin/users must return 401 (status ${disabledAdminApiResponse.status})`);
  // Active admin accepted at /admin/users and /api/admin/users
  const activeAdminAccount = await db.user.create({
    data: { name: "Production active admin", email: `production-active-admin-${randomUUID()}@example.invalid`, role: "ADMIN", disabledAt: null },
  });
  fixtureUserIds.push(activeAdminAccount.id);
  const activeAdminToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: activeAdminAccount.id, tokenHash: createHash("sha256").update(activeAdminToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const activeAdminCookieHeader = `${SESSION_COOKIE}=${activeAdminToken}`;
  const activeAdminPage = await browser.newPage();
  await activeAdminPage.context().addCookies([{ name: SESSION_COOKIE, value: activeAdminToken, url: origin }]);
  await activeAdminPage.goto(`${origin}/admin/users`);
  await activeAdminPage.getByRole("heading", { name: "Installation administration" }).waitFor();
  await activeAdminPage.getByRole("heading", { name: "Accounts" }).waitFor();

  const activeAdminApiResponse = await fetch(`${origin}/api/admin/users`, { headers: { Cookie: activeAdminCookieHeader, Origin: origin } });
  assert.equal(activeAdminApiResponse.status, 200, `active admin /api/admin/users must return 200 (status ${activeAdminApiResponse.status})`);
});
