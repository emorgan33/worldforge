import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

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
    if (userId) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
});

test("administrators can create an account and receive a one-time setup link", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = new PrismaClient();
  let userId: string | undefined;
  try {
    const user = await db.user.create({ data: { name: "Admin fixture", email: `admin-browser-admin-${randomUUID()}@example.invalid`, role: "ADMIN" } });
    userId = user.id;
    const token = randomBytes(32).toString("base64url");
    await db.authSession.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

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
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});