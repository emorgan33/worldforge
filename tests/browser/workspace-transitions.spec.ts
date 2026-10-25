import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { WORLD_HISTORY_INDEX_KEY } from "../../src/lib/world-selection";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

type WorkspaceFixture = { page: Page; worldA: { id: string; title: string }; worldB: { id: string; title: string } };

const test = base.extend<{ workspace: WorkspaceFixture }>({
  workspace: async ({ page, context, baseURL }, run) => {
    assertIsolatedTestEnvironment();
    const db = new PrismaClient();
    let ownerId: string | undefined;
    try {
      const owner = await db.user.create({ data: { name: "Workspace transition fixture", email: `workspace-transitions-${randomUUID()}@example.invalid` } });
      ownerId = owner.id;
      const worldA = await db.world.create({ data: { ownerId, title: "Transition World A", slug: `transition-a-${randomUUID()}` } });
      const worldB = await db.world.create({ data: { ownerId, title: "Transition World B", slug: `transition-b-${randomUUID()}` } });
      await Promise.all([
        db.article.create({ data: { worldId: worldA.id, title: "Lore A", slug: `lore-a-${randomUUID()}`, contentHtml: "<p>World A content</p>" } }),
        db.article.create({ data: { worldId: worldB.id, title: "Lore B", slug: `lore-b-${randomUUID()}`, contentHtml: "<p>World B content</p>" } }),
        db.variableCollection.create({ data: { worldId: worldA.id, name: "Browser lore", prefix: "lore", variables: { create: [{ key: "world_name", type: "TERM_SIMPLE", value: "A" }] } } }),
        ...["First image", "Second image"].map((title, index) => db.imageAsset.create({ data: {
          worldId: worldA.id, title, originalName: `${index}.webp`, alt: `${title} alt`, mimeType: "image/webp",
          byteSize: 1, width: 1, height: 1, sha256: `${index}${"a".repeat(63)}`,
        } })),
        db.imageAsset.create({ data: { worldId: worldB.id, title: "B image", originalName: "b.webp", alt: "World B image", mimeType: "image/webp", byteSize: 1, width: 1, height: 1, sha256: `b${"b".repeat(63)}` } }),
      ]);
      const token = randomBytes(32).toString("base64url");
      await db.authSession.create({ data: { userId: ownerId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
      await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      await page.goto(`/?world=${worldA.id}`);
      await expect(page.getByRole("button", { name: `Switch world, current world ${worldA.title}` })).toBeVisible();
      await run({ page, worldA: { id: worldA.id, title: worldA.title }, worldB: { id: worldB.id, title: worldB.title } });
    } finally {
      await Promise.all(context.pages().map(target => target.close()));
      try { if (ownerId) await db.user.delete({ where: { id: ownerId } }); }
      finally { await db.$disconnect(); }
    }
  },
});

async function selectWorld(page: Page, title: string) {
  const switcher = page.getByRole("button", { name: /^Switch world/ }).first();
  await switcher.click();
  await page.getByRole("option", { name: new RegExp(title) }).click();
}

async function currentWorld(page: Page, title: string) {
  await expect(page.getByRole("button", { name: `Switch world, current world ${title}` })).toBeVisible();
}

async function worldUrl(page: Page, worldId: string) {
  await expect.poll(() => new URL(page.url()).searchParams.get("world")).toBe(worldId);
}

test("world snapshot commits after the last reversed destination response", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  let heldArticle: Route | undefined;
  await page.route(url => url.pathname === "/api/articles" && url.searchParams.get("worldId") === worldB.id, route => { heldArticle = route; });
  await selectWorld(page, worldB.title);
  await expect.poll(() => heldArticle).toBeTruthy();
  await expect(page.getByText("Switching worlds…")).toBeVisible();
  await currentWorld(page, worldA.title);
  expect(new URL(page.url()).searchParams.get("world")).toBe(worldA.id);

  await heldArticle!.continue();
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await expect(page.locator("main h1")).toHaveText(worldB.title);
  expect(new URL(page.url()).searchParams.get("world")).toBe(worldB.id);
});

test("a failed destination keeps the prior mounted world and can be retried", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  let attempts = 0;
  await page.route(url => url.pathname === "/api/maps" && url.searchParams.get("worldId") === worldB.id, async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: "Temporary map failure" } });
    await route.continue();
  });
  await selectWorld(page, worldB.title);
  await expect(page.locator("main [role=alert]")).toContainText(/Could not open|map/i);
  await currentWorld(page, worldA.title);
  await expect(page.locator("main h1")).toHaveText(worldA.title);

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await expect(page.locator("main h1")).toHaveText(worldB.title);
});

test("dirty asset details cancel switching assets without losing the form edit", async ({ workspace }) => {
  const { page } = workspace;
  await page.getByRole("button", { name: "Image library", exact: true }).click();
  await page.getByRole("button", { name: "View image First image" }).click();
  const detailTitle = page.getByRole("textbox", { name: "Selected image title" });
  await detailTitle.fill("Unsaved first image title");

  let prompt = "";
  page.once("dialog", async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await page.getByRole("button", { name: "View image Second image" }).click();
  expect(prompt).toMatch(/image|asset/i);
  await expect(detailTitle).toHaveValue("Unsaved first image title");
  await expect(page.getByRole("heading", { name: "First image", exact: true })).toBeVisible();
});

test("dirty asset details cancel a world switch and stay mounted", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  await page.getByRole("button", { name: "Image library", exact: true }).click();
  await page.getByRole("button", { name: "View image First image" }).click();
  const detailTitle = page.getByRole("textbox", { name: "Selected image title" });
  await detailTitle.fill("Unsaved title survives cancellation");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  let prompt = "";
  page.once("dialog", async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await selectWorld(page, worldB.title);
  expect(prompt).toMatch(/image details/i);
  await currentWorld(page, worldA.title);
  await worldUrl(page, worldA.id);
  await expect(detailTitle).toHaveValue("Unsaved title survives cancellation");
});

test("a dirty Back traversal compensates without losing the form, then Back/Forward remains usable", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  await selectWorld(page, worldB.title);
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await page.getByRole("button", { name: "Image library", exact: true }).click();
  await page.getByRole("button", { name: "View image B image" }).click();
  const detailTitle = page.getByRole("textbox", { name: "Selected image title" });
  await detailTitle.fill("Keep this edit through cancelled Back");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  let prompt = "";
  page.once("dialog", async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await page.goBack();
  expect(prompt).toMatch(/image details/i);
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await expect(detailTitle).toHaveValue("Keep this edit through cancelled Back");

  await page.once("dialog", dialog => dialog.accept());
  await page.goBack();
  await currentWorld(page, worldA.title);
  await worldUrl(page, worldA.id);
  await page.goForward();
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await page.goBack();
  await currentWorld(page, worldA.title);
  await worldUrl(page, worldA.id);
});

test("a pending feature write blocks world switching until it settles", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  await page.getByRole("button", { name: "Variables", exact: true }).click();
  const value = page.getByRole("textbox", { name: "Value for [lore:world_name]", exact: true });
  await expect(value).toBeVisible();
  const writes: Route[] = [];
  await page.route("**/api/variables", route => {
    if (route.request().method() === "PATCH") writes.push(route);
    else return route.continue();
  });
  await value.fill("Pending write");
  await value.locator("..").getByRole("button").click();
  await expect.poll(() => writes.length).toBe(1);

  let prompted = false;
  page.once("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
  await selectWorld(page, worldB.title);
  await currentWorld(page, worldA.title);
  await worldUrl(page, worldA.id);
  expect(prompted).toBe(false);

  await writes[0].continue();
  await selectWorld(page, worldB.title);
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
});

test("a pending image detail save blocks selection changes until its response settles", async ({ workspace }) => {
  const { page } = workspace;
  await page.getByRole("button", { name: "Image library", exact: true }).click();
  await page.getByRole("button", { name: "View image First image" }).click();
  const title = page.getByRole("textbox", { name: "Selected image title" });
  await title.fill("Saved first image");
  const writes: Route[] = [];
  await page.route("**/api/assets", route => {
    if (route.request().method() === "PATCH") writes.push(route);
    else return route.continue();
  });

  await page.getByRole("button", { name: "Save image details", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  let prompted = false;
  page.once("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
  await page.getByRole("button", { name: "View image Second image" }).click();
  expect(prompted).toBe(false);
  await expect(title).toHaveValue("Saved first image");

  await writes[0].continue();
  await expect(page.getByRole("status")).toContainText("Image updated.");
  await expect(title).toHaveValue("Saved first image");
  await page.getByRole("button", { name: "View image Second image" }).click();
  await expect(page.getByRole("textbox", { name: "Selected image title" })).toHaveValue("Second image");
});

test("late article detail responses cannot replace the next world's workspace", async ({ workspace }) => {
  const { page, worldB } = workspace;
  let heldDetail: Route | undefined;
  await page.route(url => url.pathname.includes("/api/articles/") && url.pathname !== "/api/articles/search", route => { heldDetail = route; });
  await page.getByRole("button", { name: "Lore A Draft", exact: true }).click();
  await expect.poll(() => heldDetail).toBeTruthy();

  await selectWorld(page, worldB.title);
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await expect(page.locator("main h1")).toHaveText(worldB.title);
  await heldDetail!.continue().catch(() => undefined);
  await expect(page.locator("main h1")).toHaveText(worldB.title);
  expect(new URL(page.url()).searchParams.get("world")).toBe(worldB.id);
});

test("Back and Forward can be repeated after successful world switches", async ({ workspace }) => {
  const { page, worldA, worldB } = workspace;
  await selectWorld(page, worldB.title);
  await currentWorld(page, worldB.title);
  await worldUrl(page, worldB.id);
  await expect.poll(() => page.evaluate(key => history.state?.[key], WORLD_HISTORY_INDEX_KEY)).toBe(1);
  for (let traversal = 0; traversal < 2; traversal++) {
    await page.goBack();
    await currentWorld(page, worldA.title);
    await worldUrl(page, worldA.id);
    await expect(page.locator("main h1")).toHaveText(worldA.title);
    await page.goForward();
    await currentWorld(page, worldB.title);
    await worldUrl(page, worldB.id);
    await expect(page.locator("main h1")).toHaveText(worldB.title);
  }
});
