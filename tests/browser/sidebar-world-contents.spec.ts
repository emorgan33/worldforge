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

test("World contents keeps a usable height on a short viewport", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const session = await ownerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: session.user.id, title: "Sidebar world", slug: `sidebar-fixture-${stamp}` } });
    worldId = world.id;
    await db.article.create({ data: { worldId: world.id, slug: `sidebar-article-${stamp}`, title: "Sidebar article" } });

    await page.setViewportSize({ width: 1280, height: 800 });
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/");
    await page.waitForSelector(".author-workspace");

    const sizes = await page.evaluate(() => {
      const section = document.querySelector('section[aria-label="World contents"]');
      const inner = section?.querySelector(":scope > div");
      return {
        section: section?.getBoundingClientRect().height ?? 0,
        inner: inner?.getBoundingClientRect().height ?? 0,
        innerScroll: inner?.scrollHeight ?? 0,
      };
    });
    expect(sizes.section).toBeGreaterThanOrEqual(180);
    expect(sizes.inner).toBeLessThanOrEqual(sizes.section);
    expect(sizes.innerScroll).toBeGreaterThan(sizes.inner);
    await expect(page.getByRole("heading", { name: /World contents/ })).toBeVisible();
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
