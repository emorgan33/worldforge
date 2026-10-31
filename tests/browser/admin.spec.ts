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

test("setup links are cleared after navigation and Back", async ({ page, context, baseURL }) => {
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
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();
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
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();
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

    await page.goto(`/admin/users/${admin.user.id}`);
    await expect(page.getByRole("heading", { name: admin.user.email })).toBeVisible();
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

    await page.goto(`/admin/users/${target.id}`);
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
    await page.goto(`/admin/users/${target.id}`);
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
    await page.goto(`/admin/users/${target.id}`);
    await expect(page.getByRole("combobox", { name: /account role/i })).toBeVisible();
  } finally {
    if (targetId) await db.user.delete({ where: { id: targetId } }).catch(() => undefined);
    if (adminId) await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
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

    await page.goto(`/admin/users/${target.id}`);
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

    await page.goto(`/admin/users/${target.id}`);
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
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

    await page.goto(`/admin/users/${target.id}`);
    await expect(page.getByText("No active sessions.")).not.toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
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

    await page.goto(`/admin/users/${target.id}`);
    await page.getByRole("button", { name: "Preview deletion blockers" }).click();
    await expect(page.getByText("Allowed: No")).toBeVisible();
    await expect(page.getByText("Blocking World", { exact: true })).toBeVisible();
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

    await page.goto(`/admin/users/${target.id}`);
    await expect(page.getByRole("heading", { name: target.email })).toBeVisible();
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
