import { createHash, randomBytes, randomUUID } from "node:crypto";
import { testPrismaClient } from "../test-prisma-client";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "../auth-fixture";

async function ownerSession(db: PrismaClient) {
  const user = await db.user.create({ data: { name: "Sidebar fixture owner", email: `sidebar-fixture-${randomUUID()}@example.invalid` } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, token };
}

async function fixture(db: PrismaClient) {
  const session = await ownerSession(db);
  const stamp = randomUUID();
  const world = await db.world.create({ data: { ownerId: session.user.id, title: "Explorer world", slug: `explorer-fixture-${stamp}` } });
  const category = await db.category.create({ data: { worldId: world.id, name: "The Sundren Kingdom", parentId: null, order: 0 } });
  const article = await db.article.create({ data: { worldId: world.id, categoryId: category.id, slug: `explorer-article-${stamp}`, title: "The Beacon at Saltmere" } });
  return { ...session, world, category, article };
}

test("World contents explorer keeps a usable height in Articles on a short viewport", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const fixtureData = await fixture(db);
    userId = fixtureData.user.id;
    worldId = fixtureData.world.id;

    await page.setViewportSize({ width: 1280, height: 800 });
    await context.addCookies([{ name: SESSION_COOKIE, value: fixtureData.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${worldId}`);
    await page.waitForSelector(".author-workspace");

    await page.getByRole("button", { name: "Articles", exact: true }).click();
    const explorer = page.locator("#world-contents-explorer");
    await expect(explorer).toBeVisible();
    const sizes = await page.evaluate(() => {
      const section = document.querySelector('#world-contents-explorer section[aria-label="World contents"]');
      const inner = section?.querySelector(".sidebar-lore-scroll");
      return {
        section: section?.getBoundingClientRect().height ?? 0,
        inner: inner?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(sizes.section).toBeGreaterThanOrEqual(180);
    expect(sizes.inner).toBeLessThanOrEqual(sizes.section);
    await expect(page.getByRole("heading", { name: /World contents/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Articles", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("pin keeps the explorer across tools while an explicit collapse persists", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const fixtureData = await fixture(db);
    userId = fixtureData.user.id;
    worldId = fixtureData.world.id;
    const explorer = page.locator("#world-contents-explorer");

    await context.addCookies([{ name: SESSION_COOKIE, value: fixtureData.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${worldId}`);
    await page.getByRole("button", { name: "Articles", exact: true }).click();
    await expect(explorer).toBeVisible();

    await page.getByRole("button", { name: "Pin world contents" }).click();
    await expect(page.getByRole("button", { name: "Unpin world contents" })).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await expect(explorer).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Collapse world contents" }).click();
    await expect(explorer).toBeHidden({ timeout: 5000 });
    await page.reload();
    await expect(explorer).toBeHidden({ timeout: 10000 });
    await page.getByRole("button", { name: "Articles", exact: true }).click();
    // An explicit collapse is not overridden by article selection.
    await expect(explorer).toBeHidden({ timeout: 5000 });

    await page.getByRole("button", { name: "Show world contents" }).click();
    await expect(explorer).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Unpin world contents" }).click();
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await expect(explorer).toBeHidden({ timeout: 5000 });
    await page.getByRole("button", { name: "Articles", exact: true }).click();
    await expect(explorer).toBeVisible({ timeout: 5000 });
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("narrow layouts use a focus-managed drawer and keep tree state", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const fixtureData = await fixture(db);
    userId = fixtureData.user.id;
    worldId = fixtureData.world.id;
    const explorer = page.locator("#world-contents-explorer");

    await page.setViewportSize({ width: 390, height: 740 });
    await context.addCookies([{ name: SESSION_COOKIE, value: fixtureData.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${worldId}`);
    await page.getByRole("button", { name: "Open campaign navigation" }).click();
    await page.getByRole("button", { name: "Articles", exact: true }).click();

    const browse = page.getByRole("button", { name: "Browse world" });
    await browse.click();
    await expect(explorer).toBeVisible();
    await expect(explorer.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#world-contents-close")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(explorer).toBeHidden();
    await expect(browse).toBeFocused();

    await browse.click();
    await explorer.getByRole("button", { name: "Collapse The Sundren Kingdom" }).click();
    await explorer.getByRole("button", { name: "Expand The Sundren Kingdom" }).waitFor();
    await explorer.getByRole("button", { name: "Expand The Sundren Kingdom" }).click();
    await explorer.getByRole("button", { name: "The Beacon at Saltmere Draft", exact: true }).click();
    await expect(explorer).toBeHidden();
    await expect(browse).toBeFocused();

    await browse.click();
    await expect(explorer.getByRole("button", { name: "Collapse The Sundren Kingdom" })).toBeVisible();
    await expect(explorer.getByRole("button", { name: "The Beacon at Saltmere Draft", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator('header button[aria-controls="world-contents-explorer"]').first()).toHaveAttribute("aria-label", "Close world contents");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("template picker is a focus-managed modal", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const fixtureData = await fixture(db);
    userId = fixtureData.user.id;
    worldId = fixtureData.world.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: fixtureData.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${worldId}`);

    const trigger = page.getByRole("button", { name: "New article" });
    await trigger.click();
    const picker = page.getByRole("dialog", { name: "Choose an Article Template" });
    await expect(picker).toBeVisible();
    await expect(page.getByRole("button", { name: "Close template picker" })).toBeFocused();
    expect(await page.evaluate(() => ["#campaign-navigation", "#world-contents-explorer", "main"].every(selector => document.querySelector(selector)?.hasAttribute("inert")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => ["#campaign-navigation", "#world-contents-explorer", "main"].some(selector => document.querySelector(selector)?.hasAttribute("inert")))).toBe(false);
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("explorer drawer makes background regions inert at tablet width", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const fixtureData = await fixture(db);
    userId = fixtureData.user.id;
    worldId = fixtureData.world.id;
    await page.setViewportSize({ width: 1024, height: 768 });
    await context.addCookies([{ name: SESSION_COOKIE, value: fixtureData.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${worldId}`);

    const browse = page.getByRole("button", { name: "Browse world" });
    await browse.click();
    await expect(page.locator("#world-contents-explorer").getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => ["#campaign-navigation", "main", "header"].every(selector => document.querySelector(selector)?.hasAttribute("inert")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#world-contents-explorer")).toBeHidden();
    await expect(browse).toBeFocused();
    expect(await page.evaluate(() => ["#campaign-navigation", "main", "header"].some(selector => document.querySelector(selector)?.hasAttribute("inert")))).toBe(false);
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("sidebar branding stays above the world switcher and follows the theme", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  const { user, token } = await ownerSession(db);
  try {
    const title = "A long campaign name that must truncate rather than crowd the WorldForge brand";
    const world = await db.world.create({ data: { ownerId: user.id, title, slug: `sidebar-brand-${randomUUID()}` } });
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/?world=${world.id}`);
    const sidebar = page.locator("#campaign-navigation aside");
    const switcher = sidebar.getByRole("button", { name: `Switch world, current world ${title}` });
    const wordmark = sidebar.getByText("WorldForge", { exact: true });
    const mark = sidebar.locator('img[src*="worldforge-symbol-small-"]');
    await expect(switcher).toBeVisible();
    await expect(wordmark).toBeVisible();
    await expect(mark).toHaveAttribute("alt", "");
    await expect.poll(() => mark.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const brandBox = (await wordmark.boundingBox())!;
    const switchBox = (await switcher.boundingBox())!;
    expect(brandBox.y + brandBox.height).toBeLessThanOrEqual(switchBox.y);
    expect(await switcher.getByText(title, { exact: true }).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

    const theme = page.getByRole("combobox", { name: "Interface theme" });
    for (const [value, color] of [["night-watch", "reversed"], ["true-black", "reversed"], ["daylight", "slate"]]) {
      await theme.selectOption(value);
      await expect(theme).toBeEnabled();
      await expect(mark).toHaveAttribute("src", new RegExp(`${color}\\.svg$`));
    }

    await sidebar.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(sidebar.getByRole("img", { name: "WorldForge" })).toBeVisible();
    await expect(wordmark).toHaveCount(0);
    await switcher.focus();
    await switcher.press("Enter");
    const option = sidebar.getByRole("option", { name: new RegExp(title) });
    await expect(option).toBeVisible();
    await switcher.press("Tab");
    await expect(option).toBeFocused();
    await option.press("Escape");
    await expect(switcher).toBeFocused();

    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole("button", { name: "Open campaign navigation" }).click();
    await expect(wordmark).toBeVisible();
    await expect(mark).toHaveAttribute("alt", "");
    await expect(switcher).toBeVisible();
    await expect(switcher).not.toHaveText(/\bW\b/);
    await sidebar.getByRole("button", { name: "Close campaign navigation" }).click();
    await expect(sidebar).toBeHidden();
  } finally {
    await deleteTestUsers(db, user.id);
    await db.$disconnect();
  }
});
