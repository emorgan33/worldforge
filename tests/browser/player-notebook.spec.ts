import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { testPrismaClient } from "../test-prisma-client";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";
import { hashPassword } from "../../src/lib/passwords";

async function playerSession(db: PrismaClient) {
  const password = "Isolated notebook browser passphrase 2046!";
  const user = await db.user.create({ data: { name: "Notebook browser player", email: `notebook-browser-${randomUUID()}@example.invalid`, role: "PLAYER", passwordHash: await hashPassword(password) } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, token };
}

test("a player writes a note from an article and finds it on another device", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Notebook browser owner", email: `notebook-browser-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Notebook browser world", slug: `notebook-browser-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const article = await db.article.create({ data: { worldId: world.id, slug: `ship-${stamp}`, title: "The missing ship" } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`/c/${world.slug}/a/${article.slug}`);
    await page.getByRole("link", { name: "Take a note" }).click();
    await expect(page).toHaveURL(/\/player\/notebook$/);
    await expect(page.getByText("About: The missing ship (article)")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("The missing ship");
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Ask the harbor master about the manifest.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: /The missing ship/ })).toBeVisible();

    // A second page in the same account sees the same note.
    const second = await context.newPage();
    await second.goto("/player/notebook");
    await second.getByRole("button", { name: /The missing ship/ }).click();
    await expect(second.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Ask the harbor master about the manifest.");
    await second.getByRole("textbox", { name: "Note", exact: true }).fill("Ask about the manifest and the night watch.");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(second.getByText("Saved.")).toBeVisible();
    await second.reload();
    await second.getByRole("button", { name: /The missing ship/ }).click();
    await expect(second.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Ask about the manifest and the night watch.");

    second.once("dialog", dialog => dialog.accept());
    await second.getByRole("button", { name: "Delete" }).click();
    await expect(second.getByRole("button", { name: /The missing ship/ })).toHaveCount(0);
    await expect(second.getByText(/No notes yet/)).toBeVisible();
    await second.close();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "notebook-browser-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("a notebook load failure leaves the player able to go back", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  try {
    const session = await playerSession(db);
    userId = session.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.route("**/api/player/notes", route => route.abort());
    await page.goto("/player/notebook");
    await expect(page.getByText(/Failed to fetch|Could not load your notebook/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Player portal" })).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("the dirty guard blocks the portal link until the player confirms", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  try {
    const session = await playerSession(db);
    userId = session.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    await page.getByRole("button", { name: "New note" }).click();
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.fill("Keep this draft");

    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("link", { name: "Player portal" }).click();
    await expect(page).toHaveURL(/\/player\/notebook$/);
    await expect(title).toHaveValue("Keep this draft");

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("link", { name: "Player portal" }).click();
    await expect(page).toHaveURL(/\/player$/);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("the editor is locked while a save is in flight", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  try {
    const session = await playerSession(db);
    userId = session.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    await page.route("**/api/player/notes", async route => {
      if (route.request().method() === "POST") await new Promise(resolve => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.getByRole("button", { name: "New note" }).click();
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    const body = page.getByRole("textbox", { name: "Note", exact: true });
    await title.fill("Slow save");
    await body.fill("Typed before the delay.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(title).toBeDisabled();
    await expect(body).toBeDisabled();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(title).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(await db.playerNote.count({ where: { userId: session.user.id } })).toBe(1);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("a successful create is not duplicated when the list refresh fails", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  try {
    const session = await playerSession(db);
    userId = session.user.id;
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    let afterCreate = false;
    let failedRefresh = false;
    await page.route("**/api/player/notes", async route => {
      const method = route.request().method();
      if (method === "POST") {
        afterCreate = true;
        await route.continue();
        return;
      }
      if (method === "GET" && afterCreate && !failedRefresh) {
        failedRefresh = true;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Storage is busy." }) });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "New note" }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Only once");
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Do not duplicate me.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Saved, but the note list could not refresh. Reload the page to see it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(await db.playerNote.count({ where: { userId: session.user.id } })).toBe(1);

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => db.playerNote.count({ where: { userId: session.user.id } })).toBe(1);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("reference links honor the dirty guard", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Notebook reference owner", email: `notebook-reference-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Notebook reference world", slug: `notebook-reference-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const article = await db.article.create({ data: { worldId: world.id, slug: `ship-${stamp}`, title: "The missing ship" } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: article.id, mode: "PUBLIC", createdById: owner.id } });
    await db.playerNote.create({ data: { userId: session.user.id, worldId: world.id, resourceKind: "article", resourceId: article.id, title: "Ship note", content: "Original" } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    await page.getByRole("button", { name: /Ship note/ }).click();
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Edited but unsaved");

    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("link", { name: "The missing ship" }).click();
    await expect(page).toHaveURL(/\/player\/notebook$/);
    await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue("Edited but unsaved");

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("link", { name: "The missing ship" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${world.slug}/a/${article.slug}$`));
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "notebook-reference-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("Load latest adopts a campaign changed on another device", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldIds: string[] = [];
  try {
    const owner = await db.user.create({ data: { name: "Notebook conflict owner", email: `notebook-conflict-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const first = await db.world.create({ data: { ownerId: owner.id, title: "Conflict world one", slug: `notebook-conflict-1-${stamp}` } });
    const second = await db.world.create({ data: { ownerId: owner.id, title: "Conflict world two", slug: `notebook-conflict-2-${stamp}` } });
    worldIds = [first.id, second.id];
    await db.worldMember.createMany({ data: [
      { worldId: first.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" },
      { worldId: second.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" },
    ] });
    const note = await db.playerNote.create({ data: { userId: session.user.id, worldId: first.id, title: "Move me", content: "Original" } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    await page.getByRole("button", { name: /Move me/ }).click();

    // Another device moves the note and bumps its version.
    const other = await fetch(`${baseURL}/api/player/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${session.token}`, Origin: baseURL! },
      body: JSON.stringify({ id: note.id, title: "Move me", content: "Original", version: 1, worldId: second.id }),
    });
    assert.equal(other.status, 200, await other.text());

    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Edited on device one");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("This note changed on another device.")).toBeVisible();
    await page.getByRole("button", { name: "Load latest" }).click();

    const editor = page.getByRole("region", { name: "Note editor" });
    await expect(editor.getByLabel("Campaign")).toHaveValue(second.id);
    await editor.getByRole("textbox", { name: "Note", exact: true }).fill("Edited after loading latest");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const stored = await db.playerNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(stored.worldId).toBe(second.id);
  } finally {
    if (worldIds.length) await db.world.deleteMany({ where: { id: { in: worldIds } } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "notebook-conflict-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test("editing text does not detach a temporarily hidden campaign", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Notebook archive owner", email: `notebook-archive-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Notebook archive world", slug: `notebook-archive-${stamp}`, deletedAt: new Date() } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const note = await db.playerNote.create({ data: { userId: session.user.id, worldId: world.id, title: "Hidden campaign note", content: "Original" } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player/notebook");
    await page.getByRole("button", { name: /Hidden campaign note/ }).click();
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Edited while archived");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    expect((await db.playerNote.findUniqueOrThrow({ where: { id: note.id } })).worldId).toBe(world.id);
    await db.world.update({ where: { id: world.id }, data: { deletedAt: null } });
    await page.reload();
    await expect(page.getByRole("button", { name: /Hidden campaign note.*Notebook archive world/ })).toBeVisible();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "notebook-archive-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
