import { createHash, randomBytes, randomUUID } from "node:crypto";
import { testPrismaClient } from "../test-prisma-client";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../../src/lib/auth-constants";
import { assertIsolatedTestEnvironment } from "../auth-fixture";

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
