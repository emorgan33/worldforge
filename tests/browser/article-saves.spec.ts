import { randomBytes, createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test as base, expect, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { ARTICLE_DRAFT_WINDOW_PREFIX, articleDraftKey } from "../../src/lib/article-drafts";

const title = (page: Page) => page.getByRole("textbox", { name: "Article Title" });
const test = base.extend<{ article: { page: Page; db: PrismaClient; ownerId: string; worldId: string; id: string; keyFor: (page: Page) => Promise<string>; open: (page: Page, title?: string) => Promise<void> } }>({
  article: async ({ page, context, baseURL }, run) => {
    const db = new PrismaClient();
    let ownerId: string | undefined;
    try {
      const owner = await db.user.create({ data: { name: "Save browser fixture", email: `save-browser-${randomUUID()}@example.invalid` } });
      ownerId = owner.id;
      const world = await db.world.create({ data: { ownerId, title: "Save browser world", slug: randomUUID() } });
      const article = await db.article.create({ data: { worldId: world.id, title: "Original lore", slug: randomUUID(), contentHtml: "<p>Lore</p>" } });
      const token = randomBytes(32).toString("base64url");
      await db.authSession.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
      await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      const open = async (target: Page, articleTitle = "Original lore") => {
        await target.goto(`/?world=${world.id}`);
        await target.getByRole("button", { name: `${articleTitle} Draft`, exact: true }).click();
        await target.getByRole("button", { name: "Edit Article", exact: true }).click();
        await expect(title(target)).toBeVisible();
      };
      const keyFor = async (target: Page) => {
        const sessionId = await target.evaluate(prefix => window.name.slice(prefix.length).split(":", 1)[0], ARTICLE_DRAFT_WINDOW_PREFIX);
        return articleDraftKey(ownerId!, world.id, article.id, sessionId);
      };
      await run({ page, db, ownerId, worldId: world.id, id: article.id, keyFor, open });
    } finally {
      await Promise.all(context.pages().map(page => page.close()));
      try { if (ownerId) await db.user.delete({ where: { id: ownerId } }); }
      finally { await db.$disconnect(); }
    }
  },
});

test("legacy inherited visibility opens in the editor as private and saves unrelated edits", async ({ article }) => {
  const { page, open, db, id } = article;
  await db.article.update({ where: { id }, data: { visibility: "INHERITED" } });
  await open(page);
  await expect(page.getByRole("combobox", { name: "Article visibility" })).toHaveValue("PRIVATE");
  await title(page).fill("Updated legacy lore");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("All changes saved");
  const saved = await db.article.findUniqueOrThrow({ where: { id } });
  expect(saved.title).toBe("Updated legacy lore");
  expect(saved.visibility).toBe("PRIVATE");
});

test("two editors cannot overwrite each other; conflicts keep recovery and can save a copy", async ({ article, context }) => {
  const { page, open, db, id, worldId, keyFor } = article;
  const second = await context.newPage();
  await open(page);
  await page.evaluate(() => sessionStorage.setItem("worldforge:draft-session", "copied-session"));
  const key = await keyFor(page);
  await second.goto(`/?world=${worldId}`);
  await second.evaluate(() => sessionStorage.setItem("worldforge:draft-session", "copied-session"));
  await open(second);
  const secondKey = await keyFor(second);
  expect(secondKey).not.toBe(key);
  await expect(title(page)).toBeVisible();
  await title(page).fill("First editor wins");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("All changes saved");
  await title(second).fill("Second editor local draft");
  await expect(second.getByRole("main").getByRole("alert")).toContainText("This article changed");
  await expect(title(second)).toHaveValue("Second editor local draft");
  expect((await db.article.findUniqueOrThrow({ where: { id } })).title).toBe("First editor wins");
  const draft = await second.evaluate(key => JSON.parse(localStorage.getItem(key)!), secondKey);
  expect(draft.data.expectedVersion).toBe(1);
  expect(draft.data.title).toBe("Second editor local draft");
  await second.reload();
  await second.getByRole("button", { name: "First editor wins Draft", exact: true }).click();
  await second.getByRole("button", { name: "Edit Article", exact: true }).click();
  await expect(second.getByRole("main").getByRole("alert")).toContainText("Second editor local draft");
  await second.getByRole("button", { name: "Restore draft" }).click();
  await expect(title(second)).toHaveValue("Second editor local draft");
  await expect(second.getByRole("main").getByRole("alert")).toContainText("This article changed");
  await second.getByRole("button", { name: "Save as new article" }).click();
  await expect(second.getByRole("button", { name: "Edit Article", exact: true })).toBeVisible();
  expect(await db.article.count({ where: { worldId } })).toBe(2);
  expect((await db.article.findUniqueOrThrow({ where: { id } })).version).toBe(2);
  expect(await second.evaluate(key => localStorage.getItem(key), secondKey)).toBeNull();
});

for (const versioned of [true, false]) {
  test(`${versioned ? "stale" : "legacy versionless"} recovery restores canon state and never adopts the current server version`, async ({ article }) => {
    const { page, open, db, id, worldId, keyFor } = article;
    await open(page);
    const key = await keyFor(page);
    await page.evaluate(({ key, worldId, id, versioned }) => localStorage.setItem(key, JSON.stringify({ version: 1, articleId: id, data: {
      worldId, title: "Recovered lore", template: "GENERIC", categoryId: null, excerpt: "", tags: "", state: "DRAFT",
      contentHtml: "<p>Recovered prose</p>", metadata: { rulesSystem: "DND_5E" }, canonState: "RUMOR",
      ...(versioned ? { expectedVersion: 1 } : {}),
    } })), { key, worldId, id, versioned });
    await db.article.update({ where: { id }, data: { version: 2, excerpt: "Saved elsewhere" } });
    const patches: unknown[] = [];
    page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/api/articles/${id}`)) patches.push(request.postDataJSON()); });
    await open(page);
    await page.getByRole("button", { name: "Restore draft" }).click();
    await expect(page.getByRole("combobox", { name: "Canon state", exact: true })).toHaveValue("RUMOR");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(versioned ? "This article changed" : "no saved article version");
    expect(patches).toHaveLength(versioned ? 1 : 0);
    const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    expect(persisted.data.expectedVersion).toBe(versioned ? 1 : undefined);
    expect(persisted.data.canonState).toBe("RUMOR");
    expect((await db.article.findUniqueOrThrow({ where: { id } })).version).toBe(2);
    await page.getByRole("button", { name: "Save as new article" }).click();
    await expect(page.getByRole("button", { name: "Edit Article", exact: true })).toBeVisible();
    expect((await db.article.findFirstOrThrow({ where: { worldId, title: "Recovered lore" } })).canonState).toBe("RUMOR");
  });
}

test("typing during autosave retains newer edits and uses the committed version for the next save", async ({ article }) => {
  const { page, open, db, id, keyFor } = article;
  await open(page);
  const key = await keyFor(page);
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const versions: number[] = [];
  await page.route(`**/api/articles/${id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    versions.push(route.request().postDataJSON().expectedVersion);
    if (versions.length === 1) await held;
    await route.continue();
  });
  await title(page).fill("Submitted lore");
  await expect.poll(() => versions.length).toBe(1);
  await title(page).fill("Newer local lore");
  release!();
  await expect.poll(() => versions.length).toBe(2);
  await expect(page.getByRole("main").getByRole("status")).toHaveText("All changes saved");
  expect(versions).toEqual([1, 2]);
  expect((await db.article.findUniqueOrThrow({ where: { id } })).title).toBe("Newer local lore");
  expect((await db.article.findUniqueOrThrow({ where: { id } })).version).toBe(3);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
});
