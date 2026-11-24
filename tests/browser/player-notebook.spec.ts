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
