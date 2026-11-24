import { createHash, randomBytes, randomUUID } from "node:crypto";
import { testPrismaClient } from "../test-prisma-client";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

async function playerSession(db: PrismaClient) {
  const user = await db.user.create({ data: { name: "Feed browser player", email: `feed-browser-${randomUUID()}@example.invalid`, role: "PLAYER" } });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, token };
}

test("the player portal lists what is new and hides unshared content", async ({ page, context, baseURL }) => {
  assertIsolatedTestEnvironment();
  const db = testPrismaClient();
  let userId: string | undefined;
  let worldId: string | undefined;
  try {
    const owner = await db.user.create({ data: { name: "Feed browser owner", email: `feed-browser-owner-${randomUUID()}@example.invalid` } });
    const session = await playerSession(db);
    userId = session.user.id;
    const stamp = randomUUID();
    const world = await db.world.create({ data: { ownerId: owner.id, title: "Feed browser world", slug: `feed-browser-${stamp}` } });
    worldId = world.id;
    await db.worldMember.create({ data: { worldId: world.id, userId: session.user.id, role: "PLAYER", status: "ACTIVE" } });
    const shared = await db.article.create({ data: { worldId: world.id, slug: `shared-${stamp}`, title: "Harbor gazette", publicationStatus: "PUBLISHED", visibility: "PUBLIC" } });
    await db.article.create({ data: { worldId: world.id, slug: `private-${stamp}`, title: "GM only notes" } });
    await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "articles", resourceId: shared.id, mode: "PUBLIC", createdById: owner.id } });
    await db.playerActivity.create({ data: { worldId: world.id, resourceKind: "article", resourceId: shared.id } });

    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/player");

    await expect(page.getByRole("heading", { name: "What's new" })).toBeVisible();
    const update = page.getByRole("link", { name: /Harbor gazette/ });
    await expect(update).toBeVisible();
    await expect(update).toHaveAttribute("href", `/c/${world.slug}/a/${shared.slug}`);
    await expect(page.getByText("GM only notes")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Open world/ })).toBeVisible();
  } finally {
    if (worldId) await db.world.delete({ where: { id: worldId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: { startsWith: "feed-browser-owner-" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
