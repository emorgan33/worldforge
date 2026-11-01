import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

async function createAdminSession(db: PrismaClient, emailPrefix = "admin-browser") {
  const user = await db.user.create({
    data: { name: "Admin fixture", email: `${emailPrefix}-${randomUUID()}@example.invalid`, role: "ADMIN" },
  });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { user, token };
}

test("anonymous admin requests redirect to login", async ({ page }) => {
  assertIsolatedTestEnvironment();
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);
});

test("signed-in non-admins see an access-denied page without account data", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let userId: string | undefined;
  try {
    const user = await db.user.create({ data: { name: "Non-admin fixture", email: `admin-browser-nonadmin-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    userId = user.id;
    const token = randomBytes(32).toString("base64url");
    await db.authSession.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
    await expect(page.getByText("admin-browser-nonadmin")).not.toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("direct admin URLs deny GM, PLAYER, disabled, and revoked callers", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const ids: string[] = [];
  try {
    for (const state of [
      { role: "GM", disabledAt: null, revoked: false },
      { role: "PLAYER", disabledAt: null, revoked: false },
      { role: "ADMIN", disabledAt: new Date(), revoked: false },
      { role: "ADMIN", disabledAt: null, revoked: true },
    ]) {
      const user = await db.user.create({
        data: { name: `Denied ${state.role}`, email: `denied-${randomUUID()}@example.invalid`, role: state.role, disabledAt: state.disabledAt },
      });
      ids.push(user.id);
      const token = randomBytes(32).toString("base64url");
      const session = await db.authSession.create({
        data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
      });
      if (state.revoked) await db.authSession.delete({ where: { id: session.id } });
      await context.clearCookies();
      await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      await page.goto("/admin/audit");
      if (state.disabledAt || state.revoked) {
        await expect(page).toHaveURL(/\/login$/);
      } else {
        await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
      }
    }
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("every admin page enforces the complete caller matrix", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  test.setTimeout(120_000);
  const db = new PrismaClient();
  const userIds: string[] = [];
  try {
    const target = await db.user.create({
      data: { name: "Matrix target", email: `matrix-target-${randomUUID()}@example.invalid`, role: "AUTHOR" },
    });
    userIds.push(target.id);
    const paths = ["/admin/users", `/admin/users/${target.id}`, "/admin/audit"];
    const roles = ["AUTHOR", "GM", "PLAYER"] as const;

    for (const path of paths) {
      await context.clearCookies();
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);

      for (const role of roles) {
        const user = await db.user.create({
          data: { name: `Matrix ${role}`, email: `matrix-${role}-${randomUUID()}@example.invalid`, role },
        });
        userIds.push(user.id);
        const token = randomBytes(32).toString("base64url");
        await db.authSession.create({
          data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
        });
        await context.clearCookies();
        await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
        await page.goto(path);
        await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
        await db.user.delete({ where: { id: user.id } });
        userIds.splice(userIds.indexOf(user.id), 1);
      }

      for (const invalid of ["disabled", "expired", "revoked"] as const) {
        const user = await db.user.create({
          data: {
            name: `Matrix ${invalid}`,
            email: `matrix-${invalid}-${randomUUID()}@example.invalid`,
            role: "ADMIN",
            ...(invalid === "disabled" ? { disabledAt: new Date() } : {}),
          },
        });
        userIds.push(user.id);
        const token = randomBytes(32).toString("base64url");
        const session = await db.authSession.create({
          data: {
            userId: user.id,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + (invalid === "expired" ? -60_000 : 3_600_000)),
          },
        });
        if (invalid === "revoked") await db.authSession.delete({ where: { id: session.id } });
        await context.clearCookies();
        await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
        await db.user.delete({ where: { id: user.id } });
        userIds.splice(userIds.indexOf(user.id), 1);
      }

      const admin = await createAdminSession(db, "matrix-active-admin");
      userIds.push(admin.user.id);
      await context.clearCookies();
      await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      await page.goto(path);
      if (path === "/admin/users") await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
      else if (path === "/admin/audit") await expect(page.getByRole("heading", { name: "Installation audit" })).toBeVisible();
      else await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
      await db.user.delete({ where: { id: admin.user.id } });
      userIds.splice(userIds.indexOf(admin.user.id), 1);
    }
  } finally {
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can create an account and receive a one-time setup link", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();
    const email = `browser-created-${randomUUID()}@example.invalid`;
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Browser Created");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("status")).toContainText("One-time setup link");
    await expect(page.getByRole("status").getByRole("textbox")).toHaveValue(/\/setup#token=/);
    const created = await db.user.findUnique({ where: { email } });
    expect(created?.role).toBe("AUTHOR");
  } finally {
    await db.user.deleteMany({ where: { email: { startsWith: "browser-created-" } } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("setup links are cleared after navigation, Back, and Forward", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Email").fill(`secret-link-${randomUUID()}@example.invalid`);
    await page.getByLabel("Name").fill("Secret Link");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveValue(/\/setup#token=/);

    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await page.goBack();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await page.goBack();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
  } finally {
    await db.user.deleteMany({ where: { email: { startsWith: "secret-link-" } } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("failed account creation restores controls and reports uncertainty", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.route("**/api/admin/users", async (route) => {
      if (route.request().method() === "POST") await route.abort();
      else await route.continue();
    });

    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Email").fill(`aborted-${randomUUID()}@example.invalid`);
    await page.getByLabel("Name").fill("Aborted");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.locator("p[role='alert']")).toContainText("Unable to confirm");
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled({ timeout: 40000 });
  } finally {
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("truncated successful create responses refresh state and never replay the mutation", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetEmail = "";
  let postCount = 0;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.route("**/api/admin/users", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      postCount += 1;
      const response = await route.fetch();
      await route.fulfill({ response, body: "{truncated" });
    });

    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Create account" }).click();
    targetEmail = `truncated-${randomUUID()}@example.invalid`;
    await page.getByLabel("Email").fill(targetEmail);
    await page.getByLabel("Name").fill("Truncated response");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.locator("p[role='alert']")).toContainText("Unable to confirm");
    await expect(page.getByText(targetEmail)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled({ timeout: 40000 });
    expect(postCount).toBe(1);
    expect(await db.user.count({ where: { email: targetEmail } })).toBe(1);
  } finally {
    if (targetEmail) await db.user.deleteMany({ where: { email: targetEmail } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can revoke all of their own sessions and are signed out", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${admin.user.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByRole("heading", { name: admin.user.email })).toBeVisible({ timeout: 40000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke all access" }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can delete an eligible disabled account", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({
      data: { name: "Disposable Player", email: `disposable-${randomUUID()}@example.invalid`, role: "PLAYER", disabledAt: new Date() },
    });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await page.getByRole("button", { name: "Preview deletion blockers" }).click();
    await expect(page.getByText("Allowed: Yes")).toBeVisible();
    await page.getByLabel("Confirm current email").fill(target.email);
    await page.getByLabel("I acknowledge the account data has been backed up.").check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);

    const deleted = await db.user.findUnique({ where: { id: target.id } });
    expect(deleted).toBeNull();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("long account identifiers do not widen a 320px viewport", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const longName = "N".repeat(120);
    const longEmail = `${"a".repeat(200)}@example.invalid`;
    const target = await db.user.create({ data: { name: longName, email: longEmail, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByRole("definition").filter({ hasText: longName })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(320);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("dirty workspace changes require confirmation before Administration navigation", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let ownerId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Dirty admin fixture", email: `dirty-admin-${randomUUID()}@example.invalid`, role: "ADMIN" } });
    ownerId = owner.id;
    const world = await db.world.create({ data: { ownerId, title: "Dirty World", slug: `dirty-${randomUUID()}` } });
    await db.imageAsset.create({
      data: { worldId: world.id, title: "First image", originalName: "first.webp", alt: "First image alt", mimeType: "image/webp", byteSize: 1, width: 1, height: 1, sha256: `d${"d".repeat(63)}` },
    });
    const token = randomBytes(32).toString("base64url");
    await db.authSession.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/?world=${world.id}`);
    await page.getByRole("button", { name: "Image library", exact: true }).click();
    await page.getByRole("button", { name: "View image First image" }).click();
    await page.getByRole("textbox", { name: "Selected image title" }).fill("Unsaved admin title");

    let message = "";
    page.once("dialog", async (dialog) => {
      message = dialog.message();
      await dialog.dismiss();
    });
    await page.getByRole("button", { name: "Administration", exact: true }).click();
    expect(message).toMatch(/image details/i);
    await expect(page).toHaveURL(new RegExp(`world=${world.id}`));
    await expect(page.getByRole("textbox", { name: "Selected image title" })).toHaveValue("Unsaved admin title");

    const stored = await db.imageAsset.findFirst({ where: { worldId: world.id, title: "First image" } });
    expect(stored?.title).toBe("First image");
  } finally {
    if (ownerId) {
      await db.world.deleteMany({ where: { ownerId } });
      await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
});

test("account detail exposes accessible control names", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Accessible", email: `accessible-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByRole("combobox", { name: /account role/i })).toBeVisible({ timeout: 40000 });
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("truncated successful account detail does not crash and can be retried", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const admin = await createAdminSession(db);
  const target = await db.user.create({ data: { name: "Detail retry", email: `detail-retry-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
  try {
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    let truncate = true;
    await page.route(`**/api/admin/users/${target.id}`, async route => {
      if (truncate && route.request().method() === "GET") {
        const response = await route.fetch();
        await route.fulfill({ response, body: "{truncated" });
      } else await route.continue();
    });
    await page.goto(`/admin/users/${target.id}`);
    await expect(page.locator('p[role="alert"]')).toContainText("Unable to load account");
    await expect(page.getByRole("button", { name: "Retry loading account" })).toBeVisible();
    truncate = false;
    await page.getByRole("button", { name: "Retry loading account" }).click();
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
  } finally {
    await db.user.deleteMany({ where: { id: { in: [target.id, admin.user.id] } } });
    await db.$disconnect();
  }
});

test("malformed detail refresh keeps the last valid account and offers retry", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const admin = await createAdminSession(db);
  const target = await db.user.create({ data: { name: "Detail refresh", email: `detail-refresh-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
  try {
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/admin/users/${target.id}`);
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
    let malformed = true;
    await page.route(`**/api/admin/users/${target.id}`, async route => {
      if (malformed && route.request().method() === "GET") {
        const response = await route.fetch();
        await route.fulfill({ response, body: "{}" });
      } else await route.continue();
    });
    page.on("dialog", dialog => void dialog.accept());
    await page.getByRole("combobox", { name: "Account role" }).selectOption("PLAYER");
    await page.getByRole("button", { name: "Change role" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("Unable to load account");
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry loading account" })).toBeVisible();
    malformed = false;
    await page.getByRole("button", { name: "Retry loading account" }).click();
    await expect(page.getByRole("combobox", { name: "Account role" })).toHaveValue("PLAYER");
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: [target.id, admin.user.id] } } });
    await db.$disconnect();
  }
});

test("failed filtered pagination keeps applied results and cursor", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  const admin = await createAdminSession(db);
  const ids: string[] = [];
  const prefix = `filtered-${randomUUID()}`;
  try {
    for (let index = 0; index < 26; index++) {
      const user = await db.user.create({ data: { name: `Filtered ${index}`, email: `${prefix}-${index}@example.invalid`, role: "AUTHOR" } });
      ids.push(user.id);
    }
    const unrelated = await db.user.create({ data: { name: "Unrelated account", email: `unrelated-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    ids.push(unrelated.id);
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/admin/users");
    await page.getByLabel("Search").fill(prefix);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText(prefix);
    const originalRows = await page.locator("tbody tr").allTextContents();
    const cursors: string[] = [];
    let failPage = true;
    await page.route("**/api/admin/users?**", async route => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) {
        cursors.push(cursor);
        if (failPage) return route.abort("failed");
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    expect(await page.locator("tbody tr").allTextContents()).toEqual(originalRows);
    expect((await page.locator("tbody tr").allTextContents()).every(row => row.includes(prefix))).toBe(true);
    await expect(page.getByRole("link", { name: unrelated.email })).toHaveCount(0);
    await expect(page.getByLabel("Search")).toHaveValue(prefix);
    failPage = false;
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(26);
    expect(cursors).toHaveLength(2);
    expect(cursors[1]).toBe(cursors[0]);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.user.delete({ where: { id: admin.user.id } });
    await db.$disconnect();
  }
});

test("users pagination applies stable filters", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  const createdIds: string[] = [];
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    for (let index = 0; index < 26; index += 1) {
      const user = await db.user.create({
        data: { name: `Page User ${index}`, email: `page-user-${randomUUID()}@example.invalid`, role: "AUTHOR" },
      });
      createdIds.push(user.id);
    }
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto("/admin/users");
    await page.getByLabel("Search").fill("page-user");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();

    let releasePage!: () => void;
    const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    await page.route("**/api/admin/users?**", async (route) => {
      if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
      await pageGate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Loading…" })).toBeDisabled();
    releasePage();
    await expect(page.getByRole("button", { name: "Load more" })).not.toBeVisible();
  } finally {
    await db.user.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can issue a recovery link from account detail", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Recovery Target", email: `recovery-target-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Issue recovery link" }).click();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveValue(/\/setup#token=/);

    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await page.goBack();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can change role and disable an account", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Role Target", email: `role-target-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("No active sessions.")).toBeVisible();
    await page.getByLabel("Account role").selectOption("GM");
    await expect(page.getByLabel("Account role")).toHaveValue("GM");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Change role" }).click();
    await expect(page.getByText(/· GM ·/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Disable account" }).click();
    await expect(page.getByText(/· GM · Disabled/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Enable account" }).click();
    await expect(page.getByText(/· GM · Active/)).toBeVisible();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("administrators can revoke a single target session", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Session Target", email: `session-target-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await db.authSession.create({ data: { userId: target.id, tokenHash: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByText("No active sessions.")).not.toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    // Use an exact locator to avoid matching "Revoke all access"
    await page.locator('section').filter({ hasText: 'Sessions' }).getByRole('button', { name: /^Revoke$/, exact: true }).click();
    await expect(page.getByText("No active sessions.")).toBeVisible();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("blocked deletion shows blockers", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  let worldId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Blocked Target", email: `blocked-target-${randomUUID()}@example.invalid`, role: "AUTHOR", disabledAt: new Date() } });
    targetId = target.id;
    const world = await db.world.create({ data: { ownerId: target.id, title: "Blocking World", slug: `blocking-${randomUUID()}` } });
    worldId = world.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await page.getByRole("button", { name: "Preview deletion blockers" }).click();
    await expect(page.getByText("Allowed: No")).toBeVisible();
    await expect(page.getByText("Blocking World", { exact: true })).toBeVisible();

    // Attempt blocked deletion
    await page.getByLabel("Confirm current email").fill(target.email);
    await page.getByLabel("I acknowledge the account data has been backed up.").check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/owns worlds/i);
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("stale account versions are reported", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Stale Target", email: `stale-target-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("No active sessions.")).toBeVisible();
    await db.user.update({ where: { id: target.id }, data: { accountVersion: { increment: 1 } } });
    await page.getByLabel("Account role").selectOption("GM");
    await expect(page.getByLabel("Account role")).toHaveValue("GM");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Change role" }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/changed|stale|unable/i);
    await expect(page.locator("p[role='alert']")).toBeFocused();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("audit pagination disables filter changes while a page is in flight", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  const auditIds: string[] = [];
  const targetId = `audit-page-${randomUUID()}`;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    for (let index = 0; index < 26; index += 1) {
      const row = await db.installationAuditEvent.create({
        data: {
          targetIdSnapshot: targetId,
          action: "ACCOUNT_CREATE",
          outcome: "SUCCESS",
          detailsJson: "{}",
          actorType: "LOCAL_OPERATOR",
        },
      });
      auditIds.push(row.id);
    }
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/admin/audit");
    await page.getByLabel("Target account ID").fill(targetId);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();

    let releasePage!: () => void;
    const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    await page.route("**/api/admin/audit?**", async (route) => {
      if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
      await pageGate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Loading…" })).toBeDisabled();
    releasePage();
    await expect(page.getByRole("button", { name: "Load more" })).not.toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(27);
  } finally {
    await db.installationAuditEvent.deleteMany({ where: { id: { in: auditIds } } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("late setup responses do not restore secrets after client-side link navigation", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    await page.route("**/api/admin/users", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      await createGate;
      await route.fulfill({ response });
    });

    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Email").fill(`late-secret-${randomUUID()}@example.invalid`);
    await page.getByLabel("Name").fill("Late Secret");
    await page.getByRole("button", { name: "Create" }).click();

    // Navigate away while response is held
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);

    // Release late response
    releaseCreate();
    await page.waitForTimeout(500); // Wait for potential state update

    // Navigate back: secret must NOT be visible
    await page.goBack();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
  } finally {
    await db.user.deleteMany({ where: { email: { startsWith: "late-secret-" } } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("incomplete recovery responses refresh state and report uncertainty", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Incomplete Recovery", email: `incomplete-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.route("**/api/admin/users/*/recovery", async (route) => {
      const response = await route.fetch();
      // Succeed but return incomplete data
      await route.fulfill({ response, body: JSON.stringify({ ok: true, user: {} }) });
    });

    await page.goto(`/admin/users/${target.id}`); await expect(page.locator("#loading-account")).not.toBeVisible({ timeout: 40000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Issue recovery link" }).click();

    await expect(page.locator("p[role='alert']")).toContainText("Unable to confirm");
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
    // State must be refreshed (account version incremented in DB by issuance)
    const versionAfter = await page.getByRole("definition").filter({ hasText: "1" }).count();
    expect(versionAfter).toBeGreaterThan(0);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("truncated self revoke-all clears local identity after commit", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.route("**/api/admin/users/*/sessions/revoke-all", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: "{truncated" });
    });

    await page.goto(`/admin/users/${admin.user.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke all access" }).click();
    await expect(page).toHaveURL(/\/login$/);

    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeUndefined();
    expect(await db.authSession.count({ where: { userId: admin.user.id } })).toBe(0);
  } finally {
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("late recovery responses do not restore secrets after client-side link navigation", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({ data: { name: "Late Recovery", email: `late-recovery-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    await page.route("**/api/admin/users/*/recovery", async (route) => {
      const response = await route.fetch();
      await recoveryGate;
      await route.fulfill({ response });
    });

    await page.goto(`/admin/users/${target.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    const recoveryResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/users/${target.id}/recovery`) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Issue recovery link" }).click();
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    releaseRecovery();
    await recoveryResponse;
    await page.goBack();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveCount(0);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("keyboard confirmation returns focus after a status change", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({
      data: { name: "Keyboard confirmation", email: `keyboard-confirm-${randomUUID()}@example.invalid`, role: "AUTHOR" },
    });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`);
    const disableButton = page.getByRole("button", { name: "Disable account" });
    await disableButton.focus();
    const confirmation = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        await dialog.accept();
        resolve();
      });
    });
    await page.keyboard.press("Enter");
    await confirmation;

    await expect(page.getByText(/· AUTHOR · Disabled/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable account" })).toBeFocused();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("non-self revoke-all reports conflicts and network failures and restores controls", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({
      data: { name: "Revoke failure target", email: `revoke-failure-${randomUUID()}@example.invalid`, role: "AUTHOR" },
    });
    targetId = target.id;
    const targetSessionToken = randomBytes(32).toString("base64url");
    const targetSession = await db.authSession.create({
      data: {
        userId: target.id,
        tokenHash: createHash("sha256").update(targetSessionToken).digest("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    let attempts = 0;
    await page.route(`**/api/admin/users/${target.id}/sessions/revoke-all`, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "STALE_ACCOUNT", error: "Account changed; refresh and retry." }) });
      } else {
        await route.abort("failed");
      }
    });

    await page.goto(`/admin/users/${target.id}`);
    const revokeAll = page.getByRole("button", { name: "Revoke all access" });
    page.once("dialog", (dialog) => dialog.accept());
    await revokeAll.click();
    await expect(page.locator("p[role='alert']")).toContainText("Account changed");
    await expect(revokeAll).toBeEnabled();
    await expect(page.getByText(targetSession.id)).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "Sessions" }).getByRole("button", { name: /^Revoke$/ })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await revokeAll.click();
    await expect(page.locator("p[role='alert']")).toContainText("Unable to confirm");
    await expect(revokeAll).toBeEnabled();
    expect(attempts).toBe(2);
    expect(await db.authSession.count({ where: { userId: target.id } })).toBe(1);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("detail mutations work after returning from another admin page", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await createAdminSession(db);
    adminId = admin.user.id;
    const target = await db.user.create({
      data: { name: "Mutation after return", email: `return-mutation-${randomUUID()}@example.invalid`, role: "AUTHOR" },
    });
    targetId = target.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: admin.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    await page.goto(`/admin/users/${target.id}`);
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Issue recovery link" }).click();
    await expect(page.getByRole("status").getByRole("textbox")).toHaveValue(/\/setup#token=/);
    await expect(page.locator("p[role='alert']")).toHaveCount(0);
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("expired admin sessions are redirected from every admin page", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let adminId: string | undefined;
  let targetId: string | undefined;
  try {
    const admin = await db.user.create({ data: { name: "Expired Admin", email: `expired-admin-${randomUUID()}@example.invalid`, role: "ADMIN" } });
    adminId = admin.id;
    const target = await db.user.create({ data: { name: "Expired Target", email: `expired-target-${randomUUID()}@example.invalid`, role: "AUTHOR" } });
    targetId = target.id;
    const token = randomBytes(32).toString("base64url");
    await db.authSession.create({ data: { userId: admin.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() - 60_000) } });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

    for (const path of ["/admin/users", `/admin/users/${target.id}`, "/admin/audit"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    await db.$disconnect();
  }
});
