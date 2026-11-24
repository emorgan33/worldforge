import { createHash, randomBytes, randomUUID } from "node:crypto";
import { testPrismaClient } from "../test-prisma-client";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";
import { hashPassword } from "../../src/lib/passwords";

async function playerSession(db: PrismaClient) {
  const password = "Isolated bookmark browser passphrase 2046!";
  const user = await db.user.create({ data: { name: "Bookmark browser player", email: `bookmark-browser-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, token };
}

test("players save an article and find it on another device", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Bookmark browser owner", email: `bookmark-browser-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Bookmark browser world", slug: `bookmark-browser-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const article = await db.article.create({ data: { worldId: world.id, slug: `saved-${stamp}`, title: "Harbor gazette", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/c/${world.slug}/a/${article.slug}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();

    // A second page in the same account sees the bookmark.
    const second = await context.newPage();
    await second.goto("/player");
    const savedLink = second.getByRole("link", { name: /Harbor gazette/ });
    await expect(savedLink).toBeVisible();
    await expect(savedLink).toHaveAttribute("href", `/c/${world.slug}/a/${article.slug}`);

    // Removing it updates the list immediately.
    await second.getByRole("button", { name: /Remove Harbor gazette from saved/ }).click();
    await expect(second.getByRole("link", { name: /Harbor gazette/ })).toHaveCount(0);
    await expect(second.getByText(/Nothing saved yet/)).toBeVisible();
    await second.close();

    await page.reload();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "bookmark-browser-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("a failed removal keeps the saved item and its controls for retry", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Bookmark retry owner", email: `bookmark-retry-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Bookmark retry world", slug: `bookmark-retry-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const article = await db.article.create({ data: { worldId: world.id, slug: `retry-${stamp}`, title: "Retry gazette" } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });
    await db.playerBookmark.create({ data: { userId: session.user.id, worldId: world.id, resourceKind: "article", resourceId: article.id } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    let failures = 0;
    await page.route("**/api/player/bookmarks", async route => {
      if (route.request().method() === "DELETE" && failures === 0) {
        failures += 1;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Storage is busy." }) });
        return;
      }
      await route.continue();
    });
    await page.goto("/player");

    const remove = page.getByRole("button", { name: /Remove Retry gazette from saved/ });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(page.getByText(/Storage is busy\. The item is still saved\./)).toBeVisible();
    await expect(page.getByRole("link", { name: /Retry gazette/ })).toBeVisible();
    await expect(remove).toBeVisible();

    await remove.click();
    await expect(page.getByRole("link", { name: /Retry gazette/ })).toHaveCount(0);
    await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "bookmark-retry-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("a saved-list failure leaves what's new and worlds usable", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Bookmark failure owner", email: `bookmark-failure-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Bookmark failure world", slug: `bookmark-failure-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.route("**/api/player/bookmarks", route => route.abort());
    await page.goto("/player");

    await expect(page.getByRole("heading", { name: "What's new" })).toBeVisible();
    await expect(page.getByText(/Could not load saved items|Failed to fetch/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Open world/ })).toBeVisible();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "bookmark-failure-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
